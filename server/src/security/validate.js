// Validação no BACKEND com zod. Nunca confiamos na validação feita pelo app:
// todo body/query/param é validado aqui e campos desconhecidos são rejeitados (strict),
// o que impede mass assignment (ex.: enviar "role":"admin" no cadastro).
const { z } = require("zod");
const { HttpError } = require("./errors");

function validate(schemas) {
  return (req, res, next) => {
    for (const key of ["params", "query", "body"]) {
      if (!schemas[key]) continue;
      const result = schemas[key].safeParse(req[key] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        }));
        return next(new HttpError(400, "Dados inválidos", details));
      }
      // Express 5: req.query é somente leitura, então guardamos o valor validado em req.valid
      req.valid = { ...req.valid, [key]: result.data };
    }
    next();
  };
}

// ---- Tipos reutilizáveis ----
const text = (max) => z.string().trim().max(max);
const id = z.uuid({ message: "ID inválido" });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser AAAA-MM-DD").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Data inexistente");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora deve ser HH:MM")
  .transform((s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)));

function isValidCpf(raw) {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const t of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(cpf[i]) * (t + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[t])) return false;
  }
  return true;
}
const cpf = z
  .string()
  .trim()
  .refine(isValidCpf, "CPF inválido")
  .transform((s) => s.replace(/\D/g, ""));
const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length >= 10 && s.length <= 11, "Telefone deve ter DDD + número");

// Senha forte: 10+ caracteres com maiúscula, minúscula, número e símbolo
const password = z
  .string()
  .min(10, "Senha deve ter ao menos 10 caracteres")
  .max(128)
  .regex(/[a-z]/, "Senha precisa de letra minúscula")
  .regex(/[A-Z]/, "Senha precisa de letra maiúscula")
  .regex(/\d/, "Senha precisa de número")
  .regex(/[^A-Za-z0-9]/, "Senha precisa de símbolo");

const emptyToUndef = (schema) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

module.exports = { validate, z, text, id, date, time, cpf, phone, password, emptyToUndef, isValidCpf };
