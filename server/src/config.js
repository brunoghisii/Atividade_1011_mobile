// Carrega e valida as variáveis de ambiente. O servidor se recusa a subir com configuração insegura.
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function fail(msg) {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

const env = process.env.NODE_ENV || "development";
const jwtSecret = process.env.JWT_SECRET || "";
if (jwtSecret.length < 32) {
  fail("JWT_SECRET ausente ou curto (mínimo 32 caracteres). Veja server/.env.example.");
}

const root = path.join(__dirname, "..");

module.exports = Object.freeze({
  env,
  isProd: env === "production",
  port: Number(process.env.PORT) || 3333,
  jwtSecret,
  accessTokenTtl: "15m",
  refreshTokenTtlDays: 7,
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  dbFile: path.resolve(root, process.env.DB_FILE || "./data/consultorio.db"),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || "./data/uploads"),
  maxUploadBytes: 5 * 1024 * 1024,
});
