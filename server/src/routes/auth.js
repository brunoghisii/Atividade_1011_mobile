const { Router } = require("express");
const { db, audit } = require("../db");
const { validate, z, password } = require("../security/validate");
const { loginLimiter } = require("../security/rateLimit");
const {
  verifyLogin,
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
  requireAuth,
  hashPassword,
} = require("../security/auth");
const { HttpError } = require("../security/errors");
const bcrypt = require("bcryptjs");

const r = Router();
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

r.post(
  "/login",
  loginLimiter,
  validate({
    body: z.strictObject({ email: z.email().max(200).toLowerCase(), password: z.string().min(1).max(128) }),
  }),
  async (req, res) => {
    const { email, password: pwd } = req.valid.body;
    const user = await verifyLogin(email, pwd);
    req.user = user;
    audit(req, "login");
    res.json({ user: publicUser(user), ...issueTokens(user) });
  }
);

const refreshBody = z.strictObject({ refreshToken: z.string().min(20).max(200) });

r.post("/refresh", loginLimiter, validate({ body: refreshBody }), (req, res) => {
  const { user, tokens } = rotateRefreshToken(req.valid.body.refreshToken);
  res.json({ user: publicUser(user), ...tokens });
});

r.post("/logout", validate({ body: refreshBody }), (req, res) => {
  revokeRefreshToken(req.valid.body.refreshToken);
  res.status(204).end();
});

r.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

r.post(
  "/change-password",
  requireAuth,
  loginLimiter,
  validate({ body: z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: password }) }),
  async (req, res) => {
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!(await bcrypt.compare(req.valid.body.currentPassword, row.password_hash))) {
      throw new HttpError(400, "Senha atual incorreta");
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      await hashPassword(req.valid.body.newPassword),
      req.user.id
    );
    revokeAllSessions(req.user.id); // derruba as outras sessões
    audit(req, "change_password", "user", req.user.id);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json({ user: publicUser(user), ...issueTokens(user) });
  }
);

module.exports = r;
