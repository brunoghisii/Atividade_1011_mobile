// Upload de documentos/exames do paciente com validação rigorosa:
//  - tamanho máximo (5 MB) e 1 arquivo por requisição
//  - tipo verificado pelos "magic bytes" do conteúdo (não confiamos em extensão nem no Content-Type)
//  - nome salvo é aleatório (UUID) fora de qualquer pasta pública => sem path traversal / execução
//  - download só via rota autenticada, como anexo e com nosniff
const { Router } = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const config = require("../config");
const { db, audit } = require("../db");
const { validate, z, id } = require("../security/validate");
const { requireRole } = require("../security/auth");
const { HttpError, notFound } = require("../security/errors");
const { uploadLimiter } = require("../security/rateLimit");
const { getPatient } = require("./patients");

fs.mkdirSync(config.uploadDir, { recursive: true });

const SIGNATURES = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0, parts: 2 },
});

function sanitizeName(name) {
  const base = path.basename(String(name || "arquivo")).normalize("NFKC");
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 100) || "arquivo";
}

const r = Router({ mergeParams: true });
r.use(requireRole("admin", "recepcao", "profissional"));

function assertAccess(req, patientId) {
  if (req.user.role !== "profissional") return;
  const link = db
    .prepare("SELECT 1 FROM appointments WHERE patient_id = ? AND professional_id = ? LIMIT 1")
    .get(patientId, req.user.id);
  if (!link) throw notFound("Paciente não encontrado");
}

const patientParams = z.strictObject({ patientId: id });

r.get("/", validate({ params: patientParams }), (req, res) => {
  const p = getPatient(req.valid.params.patientId);
  assertAccess(req, p.id);
  res.json(
    db
      .prepare(
        "SELECT id, original_name, mime, size, created_at FROM attachments WHERE patient_id = ? ORDER BY created_at DESC"
      )
      .all(p.id)
  );
});

r.post("/", uploadLimiter, validate({ params: patientParams }), upload.single("file"), (req, res) => {
  const p = getPatient(req.valid.params.patientId);
  assertAccess(req, p.id);
  if (!req.file) throw new HttpError(400, "Envie um arquivo no campo 'file'");
  const sig = SIGNATURES.find((s) => s.test(req.file.buffer));
  if (!sig) throw new HttpError(415, "Tipo de arquivo não permitido (apenas PDF, PNG ou JPEG)");

  const attId = crypto.randomUUID();
  const stored = `${attId}.${sig.ext}`;
  fs.writeFileSync(path.join(config.uploadDir, stored), req.file.buffer, { flag: "wx", mode: 0o600 });
  db.prepare(
    "INSERT INTO attachments (id, patient_id, original_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(attId, p.id, sanitizeName(req.file.originalname), stored, sig.mime, req.file.size, req.user.id);
  audit(req, "upload", "attachment", attId);
  res.status(201).json({ id: attId, original_name: sanitizeName(req.file.originalname), mime: sig.mime, size: req.file.size });
});

// Rotas por id do anexo: confere que o anexo pertence ao paciente da URL E que o usuário tem acesso
const attParams = z.strictObject({ patientId: id, attachmentId: id });
function loadAttachment(req) {
  const { patientId, attachmentId } = req.valid.params;
  const a = db.prepare("SELECT * FROM attachments WHERE id = ? AND patient_id = ?").get(attachmentId, patientId);
  if (!a) throw notFound("Anexo não encontrado");
  assertAccess(req, a.patient_id);
  return a;
}

r.get("/:attachmentId", validate({ params: attParams }), (req, res) => {
  const a = loadAttachment(req);
  audit(req, "download", "attachment", a.id);
  res.set({
    "Content-Type": a.mime,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.original_name)}`,
    "Cache-Control": "no-store",
  });
  res.sendFile(path.join(config.uploadDir, a.stored_name));
});

r.delete("/:attachmentId", requireRole("admin", "recepcao"), validate({ params: attParams }), (req, res) => {
  const a = loadAttachment(req);
  db.prepare("DELETE FROM attachments WHERE id = ?").run(a.id);
  fs.rmSync(path.join(config.uploadDir, a.stored_name), { force: true });
  audit(req, "delete", "attachment", a.id);
  res.status(204).end();
});

module.exports = r;
