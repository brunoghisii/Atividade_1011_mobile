const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "consultorio-test-"));
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.DB_FILE = path.join(tmp, "test.db");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.CORS_ORIGINS = "http://localhost:8081";

const { db } = require("../src/db");
const { hashPassword } = require("../src/security/auth");
const app = require("../src/app");

let server, base;
const PWD = "Senha#Forte123";
const tokens = {};
const ids = {};

async function api(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

before(async () => {
  for (const [key, role] of [["admin", "admin"], ["recep", "recepcao"], ["prof", "profissional"], ["prof2", "profissional"]]) {
    ids[key] = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)")
      .run(ids[key], key, `${key}@c.com`, role, await hashPassword(PWD));
  }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ["admin", "recep", "prof", "prof2"]) {
    const r = await api("POST", "/auth/login", { body: { email: `${k}@c.com`, password: PWD } });
    assert.equal(r.status, 200);
    tokens[k] = r.body.accessToken;
    if (k === "recep") tokens.recepRefresh = r.body.refreshToken;
  }
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("rotas protegidas exigem token; não revela tecnologia", async () => {
  const r = await api("GET", "/patients");
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("token forjado com alg none é rejeitado", async () => {
  const h = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const p = Buffer.from(JSON.stringify({ sub: ids.admin, role: "admin", tv: 0 })).toString("base64url");
  assert.equal((await api("GET", "/users", { token: `${h}.${p}.` })).status, 401);
});

test("senha armazenada como hash bcrypt", () => {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(ids.admin);
  assert.match(row.password_hash, /^\$2[aby]\$12\$/);
});

test("validação backend rejeita CPF inválido e campos extras (mass assignment)", async () => {
  let r = await api("POST", "/patients", { token: tokens.recep, body: { name: "Ana", phone: "48999990000", cpf: "111.111.111-11" } });
  assert.equal(r.status, 400);
  r = await api("POST", "/patients", { token: tokens.recep, body: { name: "Ana Silva", phone: "48999990000", id: "x" } });
  assert.equal(r.status, 400);
});

test("SQL injection na busca é tratado como texto", async () => {
  const r = await api("POST", "/patients", { token: tokens.recep, body: { name: "Maria Souza", phone: "(48) 99999-0000", cpf: "529.982.247-25" } });
  assert.equal(r.status, 201);
  ids.patient = r.body.id;
  const s = await api("GET", "/patients?q=" + encodeURIComponent("' OR 1=1 --"), { token: tokens.recep });
  assert.equal(s.status, 200);
  assert.equal(s.body.length, 0);
});

test("agenda: cria, bloqueia conflito, fluxo de status e pagamento", async () => {
  const date = "2030-01-10";
  let r = await api("POST", "/appointments", { token: tokens.recep, body: { patient_id: ids.patient, professional_id: ids.prof, date, start: "09:00", duration_min: 30, price_cents: 15000 } });
  assert.equal(r.status, 201);
  ids.appt = r.body.id;
  r = await api("POST", "/appointments", { token: tokens.recep, body: { patient_id: ids.patient, professional_id: ids.prof, date, start: "09:15", duration_min: 30 } });
  assert.equal(r.status, 409);
  r = await api("PATCH", `/appointments/${ids.appt}/status`, { token: tokens.recep, body: { status: "concluido" } });
  assert.equal(r.status, 400); // não pula etapas
  r = await api("PATCH", `/appointments/${ids.appt}/status`, { token: tokens.recep, body: { status: "confirmado" } });
  assert.equal(r.status, 200);
  r = await api("PATCH", `/appointments/${ids.appt}/status`, { token: tokens.prof, body: { status: "em_atendimento" } });
  assert.equal(r.status, 200);
  r = await api("PATCH", `/appointments/${ids.appt}/status`, { token: tokens.prof, body: { status: "concluido" } });
  assert.equal(r.status, 200);
  r = await api("PATCH", `/appointments/${ids.appt}/payment`, { token: tokens.recep, body: { paid: true, payment_method: "pix" } });
  assert.equal(r.status, 200);
  r = await api("GET", `/appointments/summary/day?date=${date}`, { token: tokens.recep });
  assert.equal(r.body.received_cents, 15000);
});

test("IDOR: outro profissional não acessa agendamento nem prontuário", async () => {
  let r = await api("PATCH", `/appointments/${ids.appt}/status`, { token: tokens.prof2, body: { status: "concluido" } });
  assert.equal(r.status, 404);
  r = await api("POST", `/patients/${ids.patient}/records`, { token: tokens.prof, body: { content: "Paciente estável." } });
  assert.equal(r.status, 201);
  r = await api("GET", `/patients/${ids.patient}/records`, { token: tokens.prof2 });
  assert.equal(r.status, 404);
  r = await api("GET", `/patients/${ids.patient}/records`, { token: tokens.recep });
  assert.equal(r.status, 403);
  r = await api("GET", "/users", { token: tokens.recep });
  assert.equal(r.status, 403);
});

test("upload: aceita PDF real, rejeita executável renomeado", async () => {
  let fd = new FormData();
  fd.append("file", new Blob([Buffer.from("MZ\x90\x00 fake exe")], { type: "application/pdf" }), "exame.pdf");
  let r = await api("POST", `/patients/${ids.patient}/attachments`, { token: tokens.recep, body: fd });
  assert.equal(r.status, 415);
  fd = new FormData();
  fd.append("file", new Blob([Buffer.from("%PDF-1.4\n%fake")], { type: "application/pdf" }), "../../exame.pdf");
  r = await api("POST", `/patients/${ids.patient}/attachments`, { token: tokens.recep, body: fd });
  assert.equal(r.status, 201);
  assert.equal(r.body.original_name, "exame.pdf");
  const d = await api("GET", `/patients/${ids.patient}/attachments/${r.body.id}`, { token: tokens.prof2 });
  assert.equal(d.status, 404);
});

test("CORS bloqueia origem desconhecida", async () => {
  const r = await api("GET", "/health", { headers: { Origin: "https://evil.com" } });
  assert.equal(r.status, 403);
});

test("refresh token: rotação e detecção de reuso", async () => {
  const r1 = await api("POST", "/auth/refresh", { body: { refreshToken: tokens.recepRefresh } });
  assert.equal(r1.status, 200);
  const reuse = await api("POST", "/auth/refresh", { body: { refreshToken: tokens.recepRefresh } });
  assert.equal(reuse.status, 401);
  const r2 = await api("POST", "/auth/refresh", { body: { refreshToken: r1.body.refreshToken } });
  assert.equal(r2.status, 401); // família inteira revogada
});

test("força bruta: conta bloqueada após 5 erros; mensagem não revela se e-mail existe", async () => {
  const unknown = await api("POST", "/auth/login", { body: { email: "naoexiste@c.com", password: "x" } });
  const wrong = await api("POST", "/auth/login", { body: { email: "prof2@c.com", password: "x" } });
  assert.equal(unknown.body.error, wrong.body.error);
  for (let i = 0; i < 4; i++) await api("POST", "/auth/login", { body: { email: "prof2@c.com", password: "x" } });
  const r = await api("POST", "/auth/login", { body: { email: "prof2@c.com", password: PWD } });
  assert.equal(r.status, 429);
});

test("erros internos não vazam detalhes", async () => {
  const r = await api("POST", "/patients", { token: tokens.recep, headers: { "Content-Type": "application/json" }, body: undefined });
  assert.ok(r.status === 400);
  const bad = await fetch(base + "/patients", { method: "POST", headers: { Authorization: `Bearer ${tokens.recep}`, "Content-Type": "application/json" }, body: "{oops" });
  const j = await bad.json();
  assert.deepEqual(j, { error: "JSON inválido" });
});
