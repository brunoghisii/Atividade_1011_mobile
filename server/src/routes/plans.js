// Planos de tratamento (ex.: fisioterapia). Progresso = sessões concluídas vinculadas ao plano.
const { Router } = require("express");
const crypto = require("node:crypto");
const { db, audit } = require("../db");
const { validate, z, text, id } = require("../security/validate");
const { requireRole } = require("../security/auth");
const { HttpError, notFound } = require("../security/errors");
const { getPatient } = require("./patients");

const r = Router({ mergeParams: true });

const PLAN_SELECT = `
  SELECT tp.id, tp.title, tp.goals, tp.total_sessions, tp.status, tp.created_at, tp.professional_id,
         u.name AS professional_name,
         (SELECT COUNT(*) FROM appointments a WHERE a.plan_id = tp.id AND a.status = 'concluido') AS done_sessions,
         (SELECT COUNT(*) FROM appointments a WHERE a.plan_id = tp.id AND a.status IN ('agendado','confirmado')) AS scheduled_sessions
  FROM treatment_plans tp JOIN users u ON u.id = tp.professional_id`;

function assertCare(req, patientId) {
  if (req.user.role !== "profissional") return;
  const link =
    db.prepare("SELECT 1 FROM appointments WHERE patient_id = ? AND professional_id = ? LIMIT 1").get(patientId, req.user.id) ||
    db.prepare("SELECT 1 FROM treatment_plans WHERE patient_id = ? AND professional_id = ? LIMIT 1").get(patientId, req.user.id);
  if (!link) throw notFound("Paciente não encontrado");
}

const params = z.strictObject({ patientId: id });

r.get("/", validate({ params }), (req, res) => {
  const p = getPatient(req.valid.params.patientId);
  assertCare(req, p.id);
  res.json(db.prepare(`${PLAN_SELECT} WHERE tp.patient_id = ? ORDER BY tp.status = 'ativo' DESC, tp.created_at DESC`).all(p.id));
});

r.post(
  "/",
  requireRole("admin", "profissional"),
  validate({
    params,
    body: z.strictObject({
      title: text(120).min(3, "Título muito curto"),
      goals: text(1000).optional(),
      total_sessions: z.number().int().min(1).max(100),
      professional_id: id.optional(), // admin escolhe; profissional é sempre ele mesmo
    }),
  }),
  (req, res) => {
    const p = getPatient(req.valid.params.patientId);
    const b = req.valid.body;
    const profId = req.user.role === "profissional" ? req.user.id : b.professional_id;
    if (!profId || !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'profissional' AND active = 1").get(profId)) {
      throw new HttpError(400, "Profissional inválido");
    }
    const planId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO treatment_plans (id, patient_id, professional_id, title, goals, total_sessions) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(planId, p.id, profId, b.title, b.goals || null, b.total_sessions);
    audit(req, "create", "treatment_plan", planId);
    res.status(201).json(db.prepare(`${PLAN_SELECT} WHERE tp.id = ?`).get(planId));
  }
);

r.patch(
  "/:planId",
  requireRole("admin", "profissional"),
  validate({
    params: z.strictObject({ patientId: id, planId: id }),
    body: z.strictObject({
      status: z.enum(["ativo", "concluido", "suspenso"]).optional(),
      total_sessions: z.number().int().min(1).max(100).optional(),
      goals: text(1000).optional(),
    }),
  }),
  (req, res) => {
    const { patientId, planId } = req.valid.params;
    const plan = db.prepare("SELECT * FROM treatment_plans WHERE id = ? AND patient_id = ?").get(planId, patientId);
    // Profissional só altera os próprios planos
    if (!plan || (req.user.role === "profissional" && plan.professional_id !== req.user.id)) throw notFound("Plano não encontrado");
    const b = req.valid.body;
    db.prepare("UPDATE treatment_plans SET status = ?, total_sessions = ?, goals = ? WHERE id = ?").run(
      b.status ?? plan.status,
      b.total_sessions ?? plan.total_sessions,
      b.goals ?? plan.goals,
      plan.id
    );
    audit(req, "update", "treatment_plan", plan.id);
    res.json(db.prepare(`${PLAN_SELECT} WHERE tp.id = ?`).get(plan.id));
  }
);

module.exports = { router: r, PLAN_SELECT };
