export const pad = (n) => String(n).padStart(2, "0");

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function dateLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEK[new Date(y, m - 1, d).getDay()];
  return `${wd}, ${pad(d)}/${pad(m)}/${y}`;
}

export const isoToBr = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
export function brToIso(br = "") {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export const minToTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export const money = (cents = 0) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function age(birth) {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}

export const STATUS = {
  agendado: { label: "Agendado", icon: "calendar-clock", color: "#6b7280" },
  confirmado: { label: "Confirmado", icon: "check", color: "#2563eb" },
  em_atendimento: { label: "Em atendimento", icon: "stethoscope", color: "#d97706" },
  concluido: { label: "Concluído", icon: "check-all", color: "#16a34a" },
  faltou: { label: "Faltou", icon: "account-off", color: "#dc2626" },
  cancelado: { label: "Cancelado", icon: "close", color: "#9ca3af" },
};

export const PAYMENT = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_debito: "Débito",
  cartao_credito: "Crédito",
  convenio: "Convênio",
};

export const ROLES = { admin: "Administrador", recepcao: "Recepção", profissional: "Profissional" };
