// Gestão (pela recepção/admin) do acesso do paciente ao portal.
// A senha criada é PROVISÓRIA: o paciente é obrigado a trocá-la no primeiro acesso.
const { Router } = require("express");
const crypto = require("node:crypto");
const { db, audit } = require("../db");
const { validate, z, id, password } = require("../security/validate");
const { requireRole, hashPassword, revokeAllSessions } = require("../security/auth");
const { HttpError, notFound } = require("../security/errors");
const { getPatient } = require("./patients");

const r = Router({ mergeParams: true });
r.use(requireRole("admin", "recepcao"));

const params = z.strictObject({ patientId: id });
const COLS = "id, email, active, must_change_password, created_at";

r.get("/", validate({ params }), (req, res) => {
  const p = getPatient(req.valid.params.patientId);
  res.json(db.prepare(`SELECT ${COLS} FROM patient_accounts WHERE patient_id = ?`).get(p.id) ?? null);
});

r.post(
  "/",
  validate({ params, body: z.strictObject({ email: z.email("E-mail inválido").max(200).toLowerCase(), password }) }),
  async (req, res) => {
    const p = getPatient(req.valid.params.patientId);
    if (!p.active) throw new HttpError(400, "Paciente inativo");
    const { email, password: pwd } = req.valid.body;
    if (db.prepare("SELECT 1 FROM patient_accounts WHERE patient_id = ?").get(p.id)) {
      throw new HttpError(409, "Este paciente já tem acesso. Use 'redefinir senha'.");
    }
    if (db.prepare("SELECT 1 FROM patient_accounts WHERE email = ?").get(email)) {
      throw new HttpError(409, "E-mail já usado por outro paciente");
    }
    const accId = crypto.randomUUID();
    db.prepare("INSERT INTO patient_accounts (id, patient_id, email, password_hash) VALUES (?, ?, ?, ?)").run(
      accId, p.id, email, await hashPassword(pwd)
    );
    audit(req, "create", "patient_account", accId);
    res.status(201).json(db.prepare(`SELECT ${COLS} FROM patient_accounts WHERE id = ?`).get(accId));
  }
);

r.patch(
  "/",
  validate({ params, body: z.strictObject({ active: z.boolean().optional(), password: password.optional() }) }),
  async (req, res) => {
    const p = getPatient(req.valid.params.patientId);
    const acc = db.prepare("SELECT * FROM patient_accounts WHERE patient_id = ?").get(p.id);
    if (!acc) throw notFound("Paciente ainda não tem acesso");
    const b = req.valid.body;
    if (b.active !== undefined) db.prepare("UPDATE patient_accounts SET active = ? WHERE id = ?").run(Number(b.active), acc.id);
    if (b.password) {
      db.prepare(
        "UPDATE patient_accounts SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?"
      ).run(await hashPassword(b.password), acc.id);
    }
    if (b.password || b.active === false) revokeAllSessions("patient", acc.id);
    audit(req, "update", "patient_account", acc.id);
    res.json(db.prepare(`SELECT ${COLS} FROM patient_accounts WHERE id = ?`).get(acc.id));
  }
);

module.exports = r;
