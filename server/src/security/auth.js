// Autenticação: senhas com bcrypt, access token JWT curto (15 min) e refresh token opaco,
// armazenado apenas como hash SHA-256, com rotação e detecção de reuso.
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { db } = require("../db");
const { HttpError, forbidden } = require("./errors");

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// Hash fictício: usado quando o e-mail não existe para manter o mesmo tempo de resposta
// (evita descobrir quais e-mails estão cadastrados medindo o tempo).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), BCRYPT_ROUNDS);

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const INVALID_LOGIN = () => new HttpError(401, "E-mail ou senha inválidos");

async function verifyLogin(email, plain) {
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    await bcrypt.compare(plain, DUMMY_HASH);
    throw INVALID_LOGIN();
  }
  const now = Date.now();
  if (user.locked_until && user.locked_until > now) {
    // Mesma mensagem genérica + compare para não revelar que a conta está bloqueada
    await bcrypt.compare(plain, DUMMY_HASH);
    throw new HttpError(429, "Muitas tentativas. Tente novamente mais tarde.");
  }
  const ok = await bcrypt.compare(plain, user.password_hash);
  if (!ok || !user.active) {
    if (!ok) {
      const failed = user.failed_logins + 1;
      const lock = failed >= MAX_FAILED_LOGINS ? now + LOCK_MINUTES * 60_000 : null;
      db.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").run(
        lock ? 0 : failed,
        lock,
        user.id
      );
    }
    throw INVALID_LOGIN();
  }
  db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(user.id);
  return user;
}

function issueTokens(user, family = crypto.randomUUID()) {
  const accessToken = jwt.sign({ role: user.role, tv: user.token_version }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.accessTokenTtl,
    algorithm: "HS256",
    issuer: "consultorio-api",
  });
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO refresh_tokens (token_hash, user_id, family, expires_at) VALUES (?, ?, ?, ?)"
  ).run(sha256(refreshToken), user.id, family, Date.now() + config.refreshTokenTtlDays * 86_400_000);
  // Limpeza de tokens expirados
  db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(Date.now());
  return { accessToken, refreshToken, expiresIn: 15 * 60 };
}

function rotateRefreshToken(refreshToken) {
  const row = db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?").get(sha256(refreshToken));
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, "Sessão expirada");
  if (row.revoked) {
    // Reuso de um refresh token já trocado = provável roubo. Revoga toda a família.
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE family = ?").run(row.family);
    throw new HttpError(401, "Sessão expirada");
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(row.user_id);
  if (!user) throw new HttpError(401, "Sessão expirada");
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").run(row.token_hash);
  return { user, tokens: issueTokens(user, row.family) };
}

function revokeRefreshToken(refreshToken) {
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").run(sha256(refreshToken));
}

// Invalida todos os tokens do usuário (troca de senha, desativação)
function revokeAllSessions(userId) {
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(userId);
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?").run(userId);
}

// Middleware: exige Bearer token válido. O token vai no header Authorization (não em cookie),
// por isso o navegador nunca o envia automaticamente => não há superfície de CSRF.
function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(new HttpError(401, "Não autenticado"));
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"], issuer: "consultorio-api" });
  } catch {
    return next(new HttpError(401, "Token inválido ou expirado"));
  }
  const user = db
    .prepare("SELECT id, name, email, role, active, token_version FROM users WHERE id = ?")
    .get(payload.sub);
  // Confere no banco: usuário desativado ou com sessões revogadas perde acesso na hora
  if (!user || !user.active || user.token_version !== payload.tv) {
    return next(new HttpError(401, "Token inválido ou expirado"));
  }
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());

module.exports = {
  hashPassword,
  verifyLogin,
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
  requireAuth,
  requireRole,
};
