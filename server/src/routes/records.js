// Prontuário: dado sensível de saúde (LGPD art. 11). Acesso restrito a profissionais
// (e admin), e o profissional só vê prontuários de pacientes que atendeu/atenderá (anti-IDOR).
// Registros são imutáveis (somente inclusão), como exige a boa prática de prontuário.
const { Router } = require("express");
const crypto = require("node:crypto");
const { db, audit } = require("../db");
const { validate, z, text, id } = require("../security/validate");
const { requireRole } = require("../security/auth");
const { HttpError, notFound } = require("../security/errors");
const { getPatient } = require("./patients");

const r = Router({ mergeParams: true });
r.use(requireRole("admin", "profissional"));

function assertCareRelation(req, patientId) {
  if (req.user.role !== "profissional") return;
  const link = db
    .prepare("SELECT 1 FROM appointments WHERE patient_id = ? AND professional_id = ? LIMIT 1")
    .get(patientId, req.user.id);
  if (!link) throw notFound("Paciente não encontrado");
}

const params = z.strictObject({ patientId: id });

r.get("/", validate({ params }), (req, res) => {
  const p = getPatient(req.valid.params.patientId);
  assertCareRelation(req, p.id);
  const rows = db
    .prepare(
      `SELECT m.id, m.content, m.created_at, m.appointment_id, u.name AS professional_name
       FROM medical_records m JOIN users u ON u.id = m.professional_id
       WHERE m.patient_id = ? ORDER BY m.created_at DESC`
    )
    .all(p.id);
  audit(req, "read", "medical_records", p.id);
  res.json(rows);
});

r.post(
  "/",
  requireRole("profissional"),
  validate({
    params,
    body: z.strictObject({ content: text(10_000).min(3, "Texto muito curto"), appointment_id: id.optional() }),
  }),
  (req, res) => {
    const p = getPatient(req.valid.params.patientId);
    assertCareRelation(req, p.id);
    const { content, appointment_id } = req.valid.body;
    if (appointment_id) {
      const a = db
        .prepare("SELECT 1 FROM appointments WHERE id = ? AND patient_id = ? AND professional_id = ?")
        .get(appointment_id, p.id, req.user.id);
      if (!a) throw new HttpError(400, "Agendamento inválido");
    }
    const recId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO medical_records (id, patient_id, professional_id, appointment_id, content) VALUES (?, ?, ?, ?, ?)"
    ).run(recId, p.id, req.user.id, appointment_id ?? null, content);
    audit(req, "create", "medical_record", recId);
    res.status(201).json({ id: recId });
  }
);

module.exports = r;
