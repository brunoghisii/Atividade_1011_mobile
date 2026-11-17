// Validação no FRONTEND: dá feedback imediato ao usuário e evita requisições inúteis.
// Não é uma barreira de segurança — o backend valida tudo de novo (ver server/src/security/validate.js).

export const onlyDigits = (s = "") => s.replace(/\D/g, "");

export function isValidCpf(raw = "") {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const t of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(cpf[i]) * (t + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[t])) return false;
  }
  return true;
}

export const isEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export const isPhone = (s = "") => [10, 11].includes(onlyDigits(s).length);

export function isDate(s = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const isTime = (s = "") => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function passwordProblems(p = "") {
  const out = [];
  if (p.length < 10) out.push("mínimo 10 caracteres");
  if (!/[a-z]/.test(p)) out.push("letra minúscula");
  if (!/[A-Z]/.test(p)) out.push("letra maiúscula");
  if (!/\d/.test(p)) out.push("número");
  if (!/[^A-Za-z0-9]/.test(p)) out.push("símbolo");
  return out;
}

// ---- Máscaras de digitação ----
export function maskCpf(v) {
  return onlyDigits(v)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
export function maskPhone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}
export function maskDateBr(v) {
  return onlyDigits(v).slice(0, 8).replace(/(\d{2})(\d)/, "$1/$2").replace(/(\d{2})(\d)/, "$1/$2");
}
export function maskTime(v) {
  return onlyDigits(v).slice(0, 4).replace(/(\d{2})(\d)/, "$1:$2");
}
export function maskMoney(v) {
  const cents = Number(onlyDigits(v).slice(0, 9) || 0);
  return (cents / 100).toFixed(2).replace(".", ",");
}
export const moneyToCents = (v = "") => Number(onlyDigits(v) || 0);
