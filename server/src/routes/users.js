const { Router } = require("express");
const crypto = require("node:crypto");
const { db, audit } = require("../db");
const { validate, z, text, id, password } = require("../security/validate");
const { requireRole, hashPassword, revokeAllSessions } = require("../security/auth");
const { HttpError, notFound } = require("../security/errors");

const r = Router();
const role = z.enum(["admin", "recepcao", "profissional"]);
const COLS = "id, name, email, role, active, created_at";

// Lista de profissionais ativos (para agendar) — qualquer usuário logado
r.get("/professionals", (req, res) => {
  res.json(db.prepare("SELECT id, name FROM users WHERE role = 'profissional' AND active = 1 ORDER BY name").all());
});

r.use(requireRole("admin"));

r.get("/", (req, res) => {
  res.json(db.prepare(`SELECT ${COLS} FROM users ORDER BY name`).all());
});

r.post(
  "/",
  validate({
    body: z.strictObject({
      name: text(120).min(2),
      email: z.email().max(200).toLowerCase(),
      role,
      password,
    }),
  }),
  async (req, res) => {
    const b = req.valid.body;
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(b.email)) {
      throw new HttpError(409, "E-mail já cadastrado");
    }
    const userId = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)").run(
      userId,
      b.name,
      b.email,
      b.role,
      await hashPassword(b.password)
    );
    audit(req, "create", "user", userId);
    res.status(201).json(db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(userId));
  }
);

r.patch(
  "/:id",
  validate({
    params: z.strictObject({ id }),
    body: z.strictObject({
      name: text(120).min(2).optional(),
      role: role.optional(),
      active: z.boolean().optional(),
      password: password.optional(),
    }),
  }),
  async (req, res) => {
    const targetId = req.valid.params.id;
    const b = req.valid.body;
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
    if (!target) throw notFound();
    if (targetId === req.user.id && (b.active === false || (b.role && b.role !== "admin"))) {
      throw new HttpError(400, "Você não pode desativar ou rebaixar a si mesmo");
    }
    db.prepare("UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?").run(
      b.name ?? target.name,
      b.role ?? target.role,
      b.active === undefined ? target.active : Number(b.active),
      targetId
    );
    if (b.password) {
      db.prepare("UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").run(
        await hashPassword(b.password),
        targetId
      );
    }
    if (b.password || b.active === false || b.role) revokeAllSessions("staff", targetId);
    audit(req, "update", "user", targetId);
    res.json(db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(targetId));
  }
);

module.exports = r;
