// Autenticação: senhas com bcrypt, access token JWT curto (15 min) e refresh token opaco,
// armazenado apenas como hash SHA-256, com rotação e detecção de reuso.
//
// Existem DOIS reinos de autenticação totalmente separados:
//   - staff   (equipe da clínica)  -> tabela users,            audience "staff"
//   - patient (portal do paciente) -> tabela patient_accounts, audience "patient"
// O "aud" do JWT é conferido em cada middleware: token de paciente não abre rota da clínica
// e token da equipe não abre rota do portal.
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { db } = require("../db");
const { HttpError, forbidden } = require("./errors");

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ISSUER = "consultorio-api";
// Hash fictício: usado quando o e-mail não existe para manter o mesmo tempo de resposta
// (evita descobrir quais e-mails estão cadastrados medindo o tempo).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), BCRYPT_ROUNDS);

// Nomes de tabela são constantes do código (nunca vêm do usuário)
const REALMS = {
  staff: { table: "users", tokens: "refresh_tokens", aud: "staff" },
  patient: { table: "patient_accounts", tokens: "patient_refresh_tokens", aud: "patient" },
};

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const INVALID_LOGIN = () => new HttpError(401, "E-mail ou senha inválidos");

async function verifyLogin(realmName, email, plain) {
  const R = REALMS[realmName];
  const user = db.prepare(`SELECT * FROM ${R.table} WHERE email = ?`).get(email);
  if (!user) {
    await bcrypt.compare(plain, DUMMY_HASH);
    throw INVALID_LOGIN();
  }
  const now = Date.now();
  if (user.locked_until && user.locked_until > now) {
    await bcrypt.compare(plain, DUMMY_HASH);
    throw new HttpError(429, "Muitas tentativas. Tente novamente mais tarde.");
  }
  const ok = await bcrypt.compare(plain, user.password_hash);
  if (!ok || !user.active) {
    if (!ok) {
      const failed = user.failed_logins + 1;
      const lock = failed >= MAX_FAILED_LOGINS ? now + LOCK_MINUTES * 60_000 : null;
      db.prepare(`UPDATE ${R.table} SET failed_logins = ?, locked_until = ? WHERE id = ?`).run(
        lock ? 0 : failed,
        lock,
        user.id
      );
    }
    throw INVALID_LOGIN();
  }
  db.prepare(`UPDATE ${R.table} SET failed_logins = 0, locked_until = NULL WHERE id = ?`).run(user.id);
  return user;
}

function issueTokens(realmName, user, family = crypto.randomUUID()) {
  const R = REALMS[realmName];
  const claims = realmName === "staff" ? { role: user.role, tv: user.token_version } : { tv: user.token_version };
  const accessToken = jwt.sign(claims, config.jwtSecret, {
    subject: user.id,
    audience: R.aud,
    expiresIn: config.accessTokenTtl,
    algorithm: "HS256",
    issuer: ISSUER,
  });
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO ${R.tokens} (token_hash, user_id, family, expires_at) VALUES (?, ?, ?, ?)`).run(
    sha256(refreshToken),
    user.id,
    family,
    Date.now() + config.refreshTokenTtlDays * 86_400_000
  );
  db.prepare(`DELETE FROM ${R.tokens} WHERE expires_at < ?`).run(Date.now());
  return { accessToken, refreshToken, expiresIn: 15 * 60 };
}

function rotateRefreshToken(realmName, refreshToken) {
  const R = REALMS[realmName];
  const row = db.prepare(`SELECT * FROM ${R.tokens} WHERE token_hash = ?`).get(sha256(refreshToken));
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, "Sessão expirada");
  if (row.revoked) {
    // Reuso de um refresh token já trocado = provável roubo. Revoga toda a família.
    db.prepare(`UPDATE ${R.tokens} SET revoked = 1 WHERE family = ?`).run(row.family);
    throw new HttpError(401, "Sessão expirada");
  }
  const user = db.prepare(`SELECT * FROM ${R.table} WHERE id = ? AND active = 1`).get(row.user_id);
  if (!user) throw new HttpError(401, "Sessão expirada");
  db.prepare(`UPDATE ${R.tokens} SET revoked = 1 WHERE token_hash = ?`).run(row.token_hash);
  return { user, tokens: issueTokens(realmName, user, row.family) };
}

function revokeRefreshToken(realmName, refreshToken) {
  db.prepare(`UPDATE ${REALMS[realmName].tokens} SET revoked = 1 WHERE token_hash = ?`).run(sha256(refreshToken));
}

// Invalida todos os tokens da conta (troca de senha, desativação)
function revokeAllSessions(realmName, userId) {
  const R = REALMS[realmName];
  db.prepare(`UPDATE ${R.table} SET token_version = token_version + 1 WHERE id = ?`).run(userId);
  db.prepare(`UPDATE ${R.tokens} SET revoked = 1 WHERE user_id = ?`).run(userId);
}

function readBearer(req, aud) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw new HttpError(401, "Não autenticado");
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"], issuer: ISSUER, audience: aud });
  } catch {
    throw new HttpError(401, "Token inválido ou expirado");
  }
}

// Middleware da EQUIPE. Token vai no header Authorization (não em cookie) => sem superfície de CSRF.
function requireAuth(req, res, next) {
  let payload;
  try {
    payload = readBearer(req, REALMS.staff.aud);
  } catch (e) {
    return next(e);
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

// Middleware do PACIENTE. O patient_id vem SEMPRE do banco a partir do token — nunca da URL/body —
// então é impossível um paciente pedir dados de outro (IDOR).
function requirePatient({ allowPasswordChange = false } = {}) {
  return (req, res, next) => {
    let payload;
    try {
      payload = readBearer(req, REALMS.patient.aud);
    } catch (e) {
      return next(e);
    }
    const acc = db
      .prepare(
        `SELECT a.id, a.patient_id, a.email, a.active, a.token_version, a.must_change_password, p.name, p.active AS patient_active
         FROM patient_accounts a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?`
      )
      .get(payload.sub);
    if (!acc || !acc.active || !acc.patient_active || acc.token_version !== payload.tv) {
      return next(new HttpError(401, "Token inválido ou expirado"));
    }
    if (acc.must_change_password && !allowPasswordChange) {
      return next(new HttpError(403, "Troque a senha provisória para continuar", [{ field: "code", message: "PASSWORD_CHANGE_REQUIRED" }]));
    }
    req.patient = { accountId: acc.id, patientId: acc.patient_id, name: acc.name, email: acc.email };
    next();
  };
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
  requirePatient,
  requireRole,
};
