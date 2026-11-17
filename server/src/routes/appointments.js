const { Router } = require("express");
const crypto = require("node:crypto");
const { db, audit, transaction } = require("../db");
const { validate, z, text, id, date, time } = require("../security/validate");
const { requireRole } = require("../security/auth");
const { HttpError, notFound, forbidden } = require("../security/errors");
const { getPatient } = require("./patients");

const r = Router();

const OPEN_HOUR = 6 * 60;
const CLOSE_HOUR = 22 * 60;
const BLOCKING = ["agendado", "confirmado", "em_atendimento", "concluido"]; // ocupam o horário

// Transições de status permitidas (fluxo real de recepção)
const TRANSITIONS = {
  agendado: ["confirmado", "em_atendimento", "faltou", "cancelado"],
  confirmado: ["em_atendimento", "faltou", "cancelado", "agendado"],
  em_atendimento: ["concluido"],
  concluido: [],
  faltou: ["agendado"],
  cancelado: ["agendado"],
};

const SELECT = `
  SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, u.name AS professional_name,
         tp.title AS plan_title
  FROM appointments a
  LEFT JOIN treatment_plans tp ON tp.id = a.plan_id
  JOIN patients p ON p.id = a.patient_id
  JOIN users u ON u.id = a.professional_id`;

// Controle de acesso por objeto (anti-IDOR): profissional só enxerga/alterna a própria agenda.
function loadAppointment(req, apptId) {
  const a = db.prepare(`${SELECT} WHERE a.id = ?`).get(apptId);
  if (!a) throw notFound("Agendamento não encontrado");
  if (req.user.role === "profissional" && a.professional_id !== req.user.id) throw notFound("Agendamento não encontrado");
  return a;
}

function assertProfessional(profId) {
  const u = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'profissional' AND active = 1").get(profId);
  if (!u) throw new HttpError(400, "Profissional inválido");
}

function assertPlan(planId, patientId) {
  const p = db.prepare("SELECT 1 FROM treatment_plans WHERE id = ? AND patient_id = ?").get(planId, patientId);
  if (!p) throw new HttpError(400, "Plano de tratamento inválido para este paciente");
}

function assertSlotFree({ professional_id, patient_id, date: d, start_min, duration_min }, ignoreId = "") {
  if (start_min < OPEN_HOUR || start_min + duration_min > CLOSE_HOUR) {
    throw new HttpError(400, "Horário fora do expediente (06:00–22:00)");
  }
  const marks = BLOCKING.map(() => "?").join(",");
  const clash = db
    .prepare(
      `SELECT a.start_min, a.professional_id = ? AS same_prof FROM appointments a
       WHERE a.date = ? AND a.id <> ? AND a.status IN (${marks})
         AND (a.professional_id = ? OR a.patient_id = ?)
         AND a.start_min < ? AND a.start_min + a.duration_min > ?`
    )
    .get(professional_id, d, ignoreId, ...BLOCKING, professional_id, patient_id, start_min + duration_min, start_min);
  if (clash) {
    throw new HttpError(
      409,
      clash.same_prof ? "O profissional já tem consulta nesse horário" : "O paciente já tem consulta nesse horário"
    );
  }
}

r.get(
  "/",
  validate({ query: z.object({ date, professionalId: id.optional() }) }),
  (req, res) => {
    const { date: d, professionalId } = req.valid.query;
    const prof = req.user.role === "profissional" ? req.user.id : professionalId ?? "";
    const rows = db
      .prepare(`${SELECT} WHERE a.date = ? AND (? = '' OR a.professional_id = ?) ORDER BY a.start_min`)
      .all(d, prof, prof);
    res.json(rows);
  }
);

const money = z.number().int().min(0).max(10_000_000); // em centavos

r.post(
  "/",
  requireRole("admin", "recepcao"),
  validate({
    body: z.strictObject({
      patient_id: id,
      professional_id: id,
      date,
      start: time,
      duration_min: z.number().int().min(10).max(240),
      reason: text(250).optional(),
      price_cents: money.optional(),
      plan_id: id.optional(),
    }),
  }),
  (req, res) => {
    const b = req.valid.body;
    const patient = getPatient(b.patient_id);
    if (b.plan_id) assertPlan(b.plan_id, b.patient_id);
    if (!patient.active) throw new HttpError(400, "Paciente inativo");
    assertProfessional(b.professional_id);
    const appt = { ...b, start_min: b.start };
    const apptId = crypto.randomUUID();
    transaction(() => {
      assertSlotFree(appt);
      db.prepare(
        `INSERT INTO appointments (id, patient_id, professional_id, date, start_min, duration_min, reason, price_cents, plan_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(apptId, b.patient_id, b.professional_id, b.date, b.start, b.duration_min, b.reason ?? null,
        b.price_cents ?? 0, b.plan_id ?? null, req.user.id);
    });
    audit(req, "create", "appointment", apptId);
    res.status(201).json(loadAppointment(req, apptId));
  }
);

// Remarcar / editar dados
r.patch(
  "/:id",
  requireRole("admin", "recepcao"),
  validate({
    params: z.strictObject({ id }),
    body: z.strictObject({
      professional_id: id.optional(),
      date: date.optional(),
      start: time.optional(),
      duration_min: z.number().int().min(10).max(240).optional(),
      reason: text(250).optional(),
      price_cents: money.optional(),
      plan_id: id.nullable().optional(),
    }),
  }),
  (req, res) => {
    const a = loadAppointment(req, req.valid.params.id);
    if (req.valid.body.plan_id) assertPlan(req.valid.body.plan_id, a.patient_id);
    if (["concluido", "cancelado", "faltou"].includes(a.status)) {
      throw new HttpError(400, "Não é possível editar um agendamento finalizado");
    }
    const b = req.valid.body;
    const m = {
      ...a,
      ...b,
      start_min: b.start ?? a.start_min,
    };
    if (b.professional_id) assertProfessional(b.professional_id);
    transaction(() => {
      assertSlotFree(m, a.id);
      db.prepare(
        "UPDATE appointments SET professional_id=?, date=?, start_min=?, duration_min=?, reason=?, price_cents=?, plan_id=? WHERE id=?"
      ).run(m.professional_id, m.date, m.start_min, m.duration_min, m.reason ?? null, m.price_cents, m.plan_id ?? null, a.id);
    });
    audit(req, "update", "appointment", a.id);
    res.json(loadAppointment(req, a.id));
  }
);

r.patch(
  "/:id/status",
  validate({
    params: z.strictObject({ id }),
    body: z.strictObject({ status: z.enum(Object.keys(TRANSITIONS)) }),
  }),
  (req, res) => {
    const a = loadAppointment(req, req.valid.params.id);
    const next = req.valid.body.status;
    if (!TRANSITIONS[a.status].includes(next)) {
      throw new HttpError(400, `Não é possível mudar de "${a.status}" para "${next}"`);
    }
    // Profissional conduz o atendimento; recepção cuida de confirmação/faltas/cancelamentos
    if (req.user.role === "profissional" && !["em_atendimento", "concluido"].includes(next)) throw forbidden();
    transaction(() => {
      if (next === "agendado") assertSlotFree(a, a.id); // reativar pode colidir com outro horário
      db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(next, a.id);
    });
    audit(req, `status:${next}`, "appointment", a.id);
    res.json(loadAppointment(req, a.id));
  }
);

r.patch(
  "/:id/payment",
  requireRole("admin", "recepcao"),
  validate({
    params: z.strictObject({ id }),
    body: z.strictObject({
      paid: z.boolean(),
      payment_method: z.enum(["dinheiro", "pix", "cartao_credito", "cartao_debito", "convenio"]).optional(),
      price_cents: money.optional(),
    }),
  }),
  (req, res) => {
    const a = loadAppointment(req, req.valid.params.id);
    const b = req.valid.body;
    if (b.paid && !b.payment_method) throw new HttpError(400, "Informe a forma de pagamento");
    db.prepare("UPDATE appointments SET paid = ?, payment_method = ?, price_cents = ? WHERE id = ?").run(
      Number(b.paid),
      b.paid ? b.payment_method : null,
      b.price_cents ?? a.price_cents,
      a.id
    );
    audit(req, b.paid ? "payment" : "payment_reverted", "appointment", a.id);
    res.json(loadAppointment(req, a.id));
  }
);

// Orientação para o paciente (exercícios para casa, cuidados) — aparece no portal do paciente.
// Só o profissional responsável pela sessão pode escrever.
r.patch(
  "/:id/guidance",
  requireRole("profissional"),
  validate({ params: z.strictObject({ id }), body: z.strictObject({ patient_guidance: text(2000) }) }),
  (req, res) => {
    const a = loadAppointment(req, req.valid.params.id);
    if (!["em_atendimento", "concluido"].includes(a.status)) {
      throw new HttpError(400, "Orientação só pode ser registrada após iniciar o atendimento");
    }
    db.prepare("UPDATE appointments SET patient_guidance = ? WHERE id = ?").run(req.valid.body.patient_guidance || null, a.id);
    audit(req, "guidance", "appointment", a.id);
    res.json(loadAppointment(req, a.id));
  }
);

// Resumo do dia (painel da recepção / profissional)
r.get("/summary/day", validate({ query: z.object({ date }) }), (req, res) => {
  const prof = req.user.role === "profissional" ? req.user.id : "";
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(status IN ('agendado','confirmado')) AS pending,
        SUM(status = 'em_atendimento') AS in_progress,
        SUM(status = 'concluido') AS done,
        SUM(status = 'faltou') AS no_show,
        SUM(status = 'cancelado') AS canceled,
        SUM(CASE WHEN paid = 1 THEN price_cents ELSE 0 END) AS received_cents,
        SUM(CASE WHEN paid = 0 AND status = 'concluido' THEN price_cents ELSE 0 END) AS receivable_cents
       FROM appointments WHERE date = ? AND (? = '' OR professional_id = ?)`
    )
    .get(req.valid.query.date, prof, prof);
  const summary = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v ?? 0)]));
  // Profissional não vê dados financeiros
  if (prof) {
    delete summary.received_cents;
    delete summary.receivable_cents;
  }
  res.json(summary);
});

module.exports = r;
module.exports.assertSlotFree = assertSlotFree;
module.exports.TRANSITIONS = TRANSITIONS;
