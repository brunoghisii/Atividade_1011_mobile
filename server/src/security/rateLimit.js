// Rate limiting por IP. O login tem limite bem mais restrito (força bruta);
// além disso, auth.js bloqueia a CONTA após 5 senhas erradas (ataque distribuído entre IPs).
const { rateLimit } = require("express-rate-limit");

const json = (message) => ({ error: message });

const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: json("Muitas requisições. Aguarde um momento."),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: json("Muitas tentativas de login. Tente novamente em 15 minutos."),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: json("Limite de uploads atingido. Tente mais tarde."),
});

module.exports = { globalLimiter, loginLimiter, uploadLimiter };
