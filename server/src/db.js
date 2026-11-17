// Banco SQLite (módulo nativo do Node). TODAS as consultas usam prepared statements com
// parâmetros (?) — nunca concatenação de strings — o que elimina SQL injection.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const config = require("./config");

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','recepcao','profissional')),
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cpf TEXT UNIQUE,
  birth_date TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  health_plan TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  professional_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,          -- YYYY-MM-DD
  start_min INTEGER NOT NULL,  -- minutos desde 00:00
  duration_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado','confirmado','em_atendimento','concluido','faltou','cancelado')),
  reason TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  plan_id TEXT REFERENCES treatment_plans(id),
  patient_guidance TEXT,       -- orientação do profissional VISÍVEL ao paciente
  source TEXT NOT NULL DEFAULT 'clinica' CHECK (source IN ('clinica','paciente')),
  created_by TEXT REFERENCES users(id), -- NULL quando o próprio paciente agendou
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, professional_id);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);

-- Plano de tratamento (ex.: fisioterapia: 10 sessões de reabilitação de joelho)
CREATE TABLE IF NOT EXISTS treatment_plans (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  professional_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  goals TEXT,
  total_sessions INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','concluido','suspenso')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plans_patient ON treatment_plans(patient_id);

-- Contas do PORTAL DO PACIENTE: tabela separada da equipe (users), com tokens próprios.
-- Assim um paciente nunca pode ganhar papel de equipe, nem por erro de cadastro.
CREATE TABLE IF NOT EXISTS patient_accounts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL UNIQUE REFERENCES patients(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patient_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES patient_accounts(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS medical_records (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  professional_id TEXT NOT NULL REFERENCES users(id),
  appointment_id TEXT REFERENCES appointments(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migração de bancos criados pela versão anterior (appointments sem plano/orientação/origem)
const apptCols = db.prepare("PRAGMA table_info(appointments)").all().map((c) => c.name);
if (!apptCols.includes("source")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA legacy_alter_table = ON;
    BEGIN;
    ALTER TABLE appointments RENAME TO appointments_old;
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      professional_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      start_min INTEGER NOT NULL,
      duration_min INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'agendado'
        CHECK (status IN ('agendado','confirmado','em_atendimento','concluido','faltou','cancelado')),
      reason TEXT,
      price_cents INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT,
      plan_id TEXT REFERENCES treatment_plans(id),
      patient_guidance TEXT,
      source TEXT NOT NULL DEFAULT 'clinica' CHECK (source IN ('clinica','paciente')),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO appointments (id, patient_id, professional_id, date, start_min, duration_min, status, reason,
      price_cents, paid, payment_method, created_by, created_at)
    SELECT id, patient_id, professional_id, date, start_min, duration_min, status, reason,
      price_cents, paid, payment_method, created_by, created_at FROM appointments_old;
    DROP TABLE appointments_old;
    CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, professional_id);
    CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
    COMMIT;
    PRAGMA legacy_alter_table = OFF;
    PRAGMA foreign_keys = ON;
  `);
}
db.exec("CREATE INDEX IF NOT EXISTS idx_appt_plan ON appointments(plan_id);");

function audit(req, action, entity, entityId) {
  db.prepare(
    "INSERT INTO audit_log (user_id, action, entity, entity_id, ip) VALUES (?, ?, ?, ?, ?)"
  ).run(req.user?.id ?? (req.patient ? `paciente:${req.patient.accountId}` : null), action, entity ?? null, entityId ?? null, req.ip ?? null);
}

function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

module.exports = { db, audit, transaction };
