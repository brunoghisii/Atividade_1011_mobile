const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const config = require("./config");
const { requireAuth } = require("./security/auth");
const { globalLimiter } = require("./security/rateLimit");
const { notFoundHandler, errorHandler, HttpError } = require("./security/errors");

const app = express();
app.disable("x-powered-by"); // não revela a tecnologia do servidor
app.set("trust proxy", config.trustProxy);

// Cabeçalhos de segurança (HSTS, nosniff, frameguard, CSP restritiva — é uma API JSON)
app.use(
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

// CORS: allowlist explícita. Requisições sem Origin (app mobile nativo, curl) são aceitas porque
// CORS é uma proteção de navegador; quem protege a API de fato é o token Bearer.
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new HttpError(403, "Origem não permitida"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false, // não usamos cookies
    maxAge: 600,
  })
);

app.use(globalLimiter);
app.use(express.json({ limit: "100kb" }));

// Nenhuma resposta da API deve ficar em cache (dados de saúde)
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/auth", require("./routes/auth"));

// Portal do paciente: autenticação própria (requirePatient) dentro do router
app.use("/portal", require("./routes/portal"));

app.use(requireAuth); // tudo abaixo exige autenticação da EQUIPE (token de paciente é rejeitado)
app.use("/users", require("./routes/users"));
app.use("/patients/:patientId/plans", require("./routes/plans").router);
app.use("/patients/:patientId/portal-account", require("./routes/portalAccounts"));
app.use("/patients/:patientId/records", require("./routes/records"));
app.use("/patients/:patientId/attachments", require("./routes/attachments"));
app.use("/patients", require("./routes/patients").router);
app.use("/appointments", require("./routes/appointments"));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
