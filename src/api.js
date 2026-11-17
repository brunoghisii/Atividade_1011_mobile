// Cliente HTTP do app.
//  - Tokens ficam no SecureStore (Keychain/Keystore criptografado), nunca no AsyncStorage.
//  - Access token curto; ao receber 401 tenta UMA renovação (refresh) e repete a requisição.
//  - Refresh concorrente é deduplicado (uma única chamada mesmo com várias requisições paralelas).
//  - Timeout em toda requisição e mensagens de erro amigáveis (sem detalhes técnicos).
import * as SecureStore from "expo-secure-store";
import { API_URL, REQUEST_TIMEOUT_MS } from "./config";

const KEY = "consultorio.session";
let session = null; // { kind: "staff" | "patient", accessToken, refreshToken, user }
// Rotas de autenticação de cada área (equipe x paciente usam endpoints e tokens separados)
const AUTH = { staff: "/auth", patient: "/portal/auth" };
const authPath = (p) => `${AUTH[session?.kind ?? "staff"]}${p}`;
let refreshing = null;
let onSessionEnd = () => {};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function setOnSessionEnd(fn) {
  onSessionEnd = fn;
}

export async function loadSession() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    session = raw ? JSON.parse(raw) : null;
    if (session && !session.kind) session.kind = "staff"; // sessões da versão anterior
  } catch {
    session = null;
  }
  return session;
}

async function saveSession(s) {
  session = s;
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(KEY);
}

async function rawFetch(path, { method = "GET", body, token, isForm } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL + path, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, data?.error || "Não foi possível concluir a operação", data?.details);
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === "AbortError") throw new ApiError(0, "Servidor demorou para responder. Tente novamente.");
    throw new ApiError(0, `Sem conexão com o servidor (${API_URL}). Verifique se a API está rodando e na mesma rede.`);
  } finally {
    clearTimeout(timer);
  }
}

async function refresh() {
  if (!session?.refreshToken) throw new ApiError(401, "Sessão expirada");
  refreshing ??= rawFetch(authPath("/refresh"), { method: "POST", body: { refreshToken: session.refreshToken } })
    .then((d) => saveSession({ kind: session.kind, accessToken: d.accessToken, refreshToken: d.refreshToken, user: d.user }))
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function api(path, opts = {}) {
  try {
    return await rawFetch(path, { ...opts, token: session?.accessToken });
  } catch (e) {
    if (e.status !== 401 || !session) throw e;
    try {
      await refresh();
    } catch {
      await saveSession(null);
      onSessionEnd();
      throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
    }
    return rawFetch(path, { ...opts, token: session.accessToken });
  }
}

export async function login(email, password, kind = "staff") {
  const d = await rawFetch(`${AUTH[kind]}/login`, { method: "POST", body: { email, password } });
  await saveSession({ kind, accessToken: d.accessToken, refreshToken: d.refreshToken, user: d.user });
  return d.user;
}

export async function changePassword(currentPassword, newPassword) {
  const d = await api(authPath("/change-password"), { method: "POST", body: { currentPassword, newPassword } });
  await saveSession({ kind: session.kind, accessToken: d.accessToken, refreshToken: d.refreshToken, user: d.user });
}

export async function logout() {
  const rt = session?.refreshToken;
  const path = authPath("/logout");
  await saveSession(null);
  if (rt) rawFetch(path, { method: "POST", body: { refreshToken: rt } }).catch(() => {});
}

// Converte erro da API em texto para o usuário (inclui detalhes de validação do backend)
export function errorMessage(e) {
  if (e?.details?.length) return e.details.map((d) => d.message).join("\n");
  return e?.message || "Erro inesperado";
}
