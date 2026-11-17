const { Router } = require("express");
const crypto = require("node:crypto");
const { db, audit } = require("../db");
const { validate, z, text, id, date, cpf, phone, emptyToUndef } = require("../security/validate");
const { requireRole } = require("../security/auth");
const { HttpError, notFound } = require("../security/errors");

const r = Router();

const fields = {
  name: text(120).min(3, "Nome muito curto"),
  cpf: emptyToUndef(cpf),
  birth_date: emptyToUndef(date),
  phone,
  email: emptyToUndef(z.email("E-mail inválido").max(200)),
  address: emptyToUndef(text(250)),
  health_plan: emptyToUndef(text(80)),
  notes: emptyToUndef(text(1000)),
};
const createSchema = z.strictObject(fields);
const updateSchema = z.strictObject({
  ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
  active: z.boolean().optional(),
});

const COLS = "id, name, cpf, birth_date, phone, email, address, health_plan, notes, active, created_at";

function getPatient(patientId) {
  const p = db.prepare(`SELECT ${COLS} FROM patients WHERE id = ?`).get(patientId);
  if (!p) throw notFound("Paciente não encontrado");
  return p;
}

r.get(
  "/",
  validate({
    query: z.object({
      q: text(80).optional(),
      inactive: z.enum(["0", "1"]).optional(),
    }),
  }),
  (req, res) => {
    const q = req.valid.query.q || "";
    const digits = q.replace(/\D/g, "");
    // LIKE parametrizado; % e _ do usuário são escapados
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const rows = db
      .prepare(
        `SELECT ${COLS} FROM patients
         WHERE (active = 1 OR ? = '1')
           AND (? = '' OR name LIKE ? ESCAPE '\\' OR (? <> '' AND (cpf LIKE ? OR phone LIKE ?)))
         ORDER BY name LIMIT 100`
      )
      .all(req.valid.query.inactive ?? "0", q, like, digits, `%${digits}%`, `%${digits}%`);
    res.json(rows);
  }
);

r.get("/:id", validate({ params: z.strictObject({ id }) }), (req, res) => {
  res.json(getPatient(req.valid.params.id));
});

// Histórico de consultas do paciente (profissional vê apenas as próprias)
r.get("/:id/appointments", validate({ params: z.strictObject({ id }) }), (req, res) => {
  const p = getPatient(req.valid.params.id);
  const own = req.user.role === "profissional";
  const rows = db
    .prepare(
      `SELECT a.id, a.date, a.start_min, a.duration_min, a.status, a.reason, a.price_cents, a.paid,
              u.name AS professional_name
       FROM appointments a JOIN users u ON u.id = a.professional_id
       WHERE a.patient_id = ? AND (? = 0 OR a.professional_id = ?)
       ORDER BY a.date DESC, a.start_min DESC LIMIT 200`
    )
    .all(p.id, own ? 1 : 0, req.user.id);
  res.json(rows);
});

r.post("/", requireRole("admin", "recepcao"), validate({ body: createSchema }), (req, res) => {
  const b = req.valid.body;
  if (b.cpf && db.prepare("SELECT 1 FROM patients WHERE cpf = ?").get(b.cpf)) {
    throw new HttpError(409, "Já existe paciente com este CPF");
  }
  const pid = crypto.randomUUID();
  db.prepare(
    `INSERT INTO patients (id, name, cpf, birth_date, phone, email, address, health_plan, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(pid, b.name, b.cpf ?? null, b.birth_date ?? null, b.phone, b.email ?? null,
    b.address ?? null, b.health_plan ?? null, b.notes ?? null);
  audit(req, "create", "patient", pid);
  res.status(201).json(getPatient(pid));
});

r.patch(
  "/:id",
  requireRole("admin", "recepcao"),
  validate({ params: z.strictObject({ id }), body: updateSchema }),
  (req, res) => {
    const p = getPatient(req.valid.params.id);
    const b = req.valid.body;
    if (b.cpf && b.cpf !== p.cpf && db.prepare("SELECT 1 FROM patients WHERE cpf = ?").get(b.cpf)) {
      throw new HttpError(409, "Já existe paciente com este CPF");
    }
    const m = { ...p, ...b, active: b.active === undefined ? p.active : Number(b.active) };
    db.prepare(
      `UPDATE patients SET name=?, cpf=?, birth_date=?, phone=?, email=?, address=?, health_plan=?, notes=?, active=?
       WHERE id = ?`
    ).run(m.name, m.cpf ?? null, m.birth_date ?? null, m.phone, m.email ?? null, m.address ?? null,
      m.health_plan ?? null, m.notes ?? null, m.active, p.id);
    audit(req, "update", "patient", p.id);
    res.json(getPatient(p.id));
  }
);

module.exports = { router: r, getPatient };
