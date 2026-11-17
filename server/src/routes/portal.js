// PORTAL DO PACIENTE — rotas usadas pelo próprio paciente.
// Regras de segurança:
//  - Autenticação separada da equipe (audience "patient", tabela patient_accounts).
//  - O paciente é identificado SÓ pelo token (req.patient.patientId). Nenhuma rota recebe
//    patient_id do cliente => não há como consultar outro paciente (IDOR impossível por desenho).
//  - Respostas com colunas explícitas: nada de prontuário, financeiro, telefone de terceiros,
//    nome de outros pacientes ou dados internos (created_by, ids de usuários etc.).
//  - Agendamento com limites anti-abuso: antecedência mínima, janela máxima, teto de consultas
//    futuras e rate limit próprio.
const { Router } = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { db, audit, transaction } = require("../db");
const { validate, z, id, date, time, password } = require("../security/validate");
const { loginLimiter } = require("../security/rateLimit");
const {
  verifyLogin, issueTokens, rotateRefreshToken, revokeRefreshToken, revokeAllSessions, requirePatient, hashPassword,
} = require("../security/auth");
const { HttpError, notFound } = require("../security/errors");
const { assertSlotFree } = require("./appointments");
const { PLAN_SELECT } = require("./plans");

const r = Router();

// ---- Regras do autoagendamento ----
const SLOT_MIN = 60;               // duração da sessão agendada pelo paciente
const OPEN = 8 * 60;               // 08:00
const CLOSE = 18 * 60;             // 18:00
const WORK_DAYS = [1, 2, 3, 4, 5]; // seg a sex
const MIN_ADVANCE_MIN = 120;       // agendar com no mínimo 2h de antecedência
const MAX_DAYS_AHEAD = 60;
const MAX_FUTURE = 3;              // no máximo 3 consultas futuras em aberto
const CANCEL_MIN_HOURS = 12;       // cancelar pelo app só com 12h de antecedência

const bookingLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de agendamento. Tente mais tarde." },
});

const pad = (n) => String(n).padStart(2, "0");
function nowLocal() {
  const d = new Date();
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, min: d.getHours() * 60 + d.getMinutes() };
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

// Minutos que faltam até a consulta (negativo = já passou)
function minutesUntil(d, startMin) {
  const now = nowLocal();
  return daysBetween(now.date, d) * 1440 + startMin - now.min;
}

function assertBookable(d, startMin) {
  if (!WORK_DAYS.includes(weekday(d))) throw new HttpError(400, "Agendamento online apenas de segunda a sexta");
  if (startMin < OPEN || startMin + SLOT_MIN > CLOSE || (startMin - OPEN) % SLOT_MIN !== 0) {
    throw new HttpError(400, "Horário indisponível");
  }
  if (minutesUntil(d, startMin) < MIN_ADVANCE_MIN) throw new HttpError(400, "Agende com pelo menos 2 horas de antecedência");
  if (daysBetween(nowLocal().date, d) > MAX_DAYS_AHEAD) throw new HttpError(400, `Agende com até ${MAX_DAYS_AHEAD} dias de antecedência`);
}

function assertProfessional(profId) {
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'profissional' AND active = 1").get(profId)) {
    throw new HttpError(400, "Profissional inválido");
  }
}

// ======================= Autenticação do paciente =======================
const publicAccount = (acc) => {
  const p = db.prepare("SELECT name FROM patients WHERE id = ?").get(acc.patient_id);
  return { id: acc.id, name: p?.name, email: acc.email, role: "paciente", mustChangePassword: !!acc.must_change_password };
};

r.post(
  "/auth/login",
  loginLimiter,
  validate({ body: z.strictObject({ email: z.email().max(200).toLowerCase(), password: z.string().min(1).max(128) }) }),
  async (req, res) => {
    const acc = await verifyLogin("patient", req.valid.body.email, req.valid.body.password);
    const patient = db.prepare("SELECT active FROM patients WHERE id = ?").get(acc.patient_id);
    if (!patient?.active) throw new HttpError(401, "E-mail ou senha inválidos");
    req.patient = { accountId: acc.id };
    audit(req, "portal_login");
    res.json({ user: publicAccount(acc), ...issueTokens("patient", acc) });
  }
);

const refreshBody = z.strictObject({ refreshToken: z.string().min(20).max(200) });

r.post("/auth/refresh", loginLimiter, validate({ body: refreshBody }), (req, res) => {
  const { user, tokens } = rotateRefreshToken("patient", req.valid.body.refreshToken);
  res.json({ user: publicAccount(user), ...tokens });
});

r.post("/auth/logout", validate({ body: refreshBody }), (req, res) => {
  revokeRefreshToken("patient", req.valid.body.refreshToken);
  res.status(204).end();
});

r.post(
  "/auth/change-password",
  requirePatient({ allowPasswordChange: true }),
  loginLimiter,
  validate({ body: z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: password }) }),
  async (req, res) => {
    const acc = db.prepare("SELECT * FROM patient_accounts WHERE id = ?").get(req.patient.accountId);
    if (!(await bcrypt.compare(req.valid.body.currentPassword, acc.password_hash))) {
      throw new HttpError(400, "Senha atual incorreta");
    }
    if (await bcrypt.compare(req.valid.body.newPassword, acc.password_hash)) {
      throw new HttpError(400, "A nova senha deve ser diferente da atual");
    }
    db.prepare("UPDATE patient_accounts SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
      await hashPassword(req.valid.body.newPassword),
      acc.id
    );
    revokeAllSessions("patient", acc.id);
    audit(req, "portal_change_password", "patient_account", acc.id);
    const fresh = db.prepare("SELECT * FROM patient_accounts WHERE id = ?").get(acc.id);
    res.json({ user: publicAccount(fresh), ...issueTokens("patient", fresh) });
  }
);

// ======================= Área logada do paciente =======================
r.use(requirePatient());

r.get("/me", (req, res) => {
  const p = db
    .prepare("SELECT name, birth_date, phone, email, health_plan FROM patients WHERE id = ?")
    .get(req.patient.patientId);
  res.json(p);
});

// Planos de tratamento + progresso
r.get("/plans", (req, res) => {
  const rows = db
    .prepare(`${PLAN_SELECT} WHERE tp.patient_id = ? ORDER BY tp.status = 'ativo' DESC, tp.created_at DESC`)
    .all(req.patient.patientId)
    .map(({ professional_id, ...rest }) => rest); // sem ids internos
  res.json(rows);
});

// Consultas/sessões do próprio paciente
r.get("/appointments", (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.date, a.start_min, a.duration_min, a.status, a.reason, a.patient_guidance,
              u.name AS professional_name, tp.title AS plan_title
       FROM appointments a
       JOIN users u ON u.id = a.professional_id
       LEFT JOIN treatment_plans tp ON tp.id = a.plan_id
       WHERE a.patient_id = ?
       ORDER BY a.date DESC, a.start_min DESC LIMIT 200`
    )
    .all(req.patient.patientId);
  res.json(rows);
});

// Profissionais disponíveis para agendar (só id e nome)
r.get("/professionals", (req, res) => {
  res.json(db.prepare("SELECT id, name FROM users WHERE role = 'profissional' AND active = 1 ORDER BY name").all());
});

// Horários livres: retorna SOMENTE os horários vagos — nunca quem ocupa os outros.
r.get(
  "/availability",
  validate({ query: z.object({ professionalId: id, date }) }),
  (req, res) => {
    const { professionalId, date: d } = req.valid.query;
    assertProfessional(professionalId);
    const slots = [];
    if (WORK_DAYS.includes(weekday(d)) && daysBetween(nowLocal().date, d) <= MAX_DAYS_AHEAD) {
      const busy = db
        .prepare(
          `SELECT start_min, duration_min FROM appointments
           WHERE date = ? AND (professional_id = ? OR patient_id = ?)
             AND status IN ('agendado','confirmado','em_atendimento','concluido')`
        )
        .all(d, professionalId, req.patient.patientId);
      for (let s = OPEN; s + SLOT_MIN <= CLOSE; s += SLOT_MIN) {
        const free = !busy.some((b) => b.start_min < s + SLOT_MIN && b.start_min + b.duration_min > s);
        if (free && minutesUntil(d, s) >= MIN_ADVANCE_MIN) slots.push(`${pad(Math.floor(s / 60))}:${pad(s % 60)}`);
      }
    }
    res.json({ date: d, duration_min: SLOT_MIN, slots });
  }
);

r.post(
  "/appointments",
  bookingLimiter,
  validate({
    body: z.strictObject({
      professional_id: id,
      date,
      start: time,
      reason: z.string().trim().max(250).optional(),
    }),
  }),
  (req, res) => {
    const b = req.valid.body;
    const patientId = req.patient.patientId;
    assertProfessional(b.professional_id);
    assertBookable(b.date, b.start);

    // Vincula automaticamente ao plano ativo do paciente com esse profissional (se houver)
    const plan = db
      .prepare("SELECT id FROM treatment_plans WHERE patient_id = ? AND professional_id = ? AND status = 'ativo' ORDER BY created_at DESC LIMIT 1")
      .get(patientId, b.professional_id);

    const apptId = crypto.randomUUID();
    transaction(() => {
      const now = nowLocal();
      const open = db
        .prepare(
          `SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status IN ('agendado','confirmado')
           AND (date > ? OR (date = ? AND start_min >= ?))`
        )
        .get(patientId, now.date, now.date, now.min).n;
      if (open >= MAX_FUTURE) {
        throw new HttpError(400, `Você já tem ${MAX_FUTURE} consultas marcadas. Fale com a clínica para agendar mais.`);
      }
      assertSlotFree({ professional_id: b.professional_id, patient_id: patientId, date: b.date, start_min: b.start, duration_min: SLOT_MIN });
      db.prepare(
        `INSERT INTO appointments (id, patient_id, professional_id, date, start_min, duration_min, reason, plan_id, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paciente', NULL)`
      ).run(apptId, patientId, b.professional_id, b.date, b.start, SLOT_MIN, b.reason || null, plan?.id ?? null);
    });
    audit(req, "portal_book", "appointment", apptId);
    res.status(201).json({ id: apptId });
  }
);

function ownAppointment(req) {
  const a = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND patient_id = ?")
    .get(req.valid.params.id, req.patient.patientId);
  if (!a) throw notFound("Consulta não encontrada");
  return a;
}

r.post("/appointments/:id/confirm", validate({ params: z.strictObject({ id }) }), (req, res) => {
  const a = ownAppointment(req);
  if (a.status !== "agendado" || minutesUntil(a.date, a.start_min) < 0) throw new HttpError(400, "Esta consulta não pode ser confirmada");
  db.prepare("UPDATE appointments SET status = 'confirmado' WHERE id = ?").run(a.id);
  audit(req, "portal_confirm", "appointment", a.id);
  res.status(204).end();
});

r.post("/appointments/:id/cancel", validate({ params: z.strictObject({ id }) }), (req, res) => {
  const a = ownAppointment(req);
  if (!["agendado", "confirmado"].includes(a.status)) throw new HttpError(400, "Esta consulta não pode ser cancelada");
  if (minutesUntil(a.date, a.start_min) < CANCEL_MIN_HOURS * 60) {
    throw new HttpError(400, `Cancelamentos com menos de ${CANCEL_MIN_HOURS}h devem ser feitos pelo telefone da clínica`);
  }
  db.prepare("UPDATE appointments SET status = 'cancelado' WHERE id = ?").run(a.id);
  audit(req, "portal_cancel", "appointment", a.id);
  res.status(204).end();
});

module.exports = r;
