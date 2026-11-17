// Tratamento de erros centralizado: o cliente recebe só mensagens genéricas e seguras.
// Stack traces, mensagens do SQLite, caminhos de arquivo etc. ficam apenas no log do servidor.
const crypto = require("node:crypto");

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

const notFound = (msg = "Recurso não encontrado") => new HttpError(404, msg);
const forbidden = () => new HttpError(403, "Acesso negado");

function notFoundHandler(req, res) {
  res.status(404).json({ error: "Rota não encontrada" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // JSON malformado / corpo grande demais
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Requisição muito grande" });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Arquivo muito grande" });
  if (err.name === "MulterError") return res.status(400).json({ error: "Upload inválido" });

  // Erro inesperado: registra com um id de correlação e devolve resposta genérica.
  const errorId = crypto.randomUUID();
  console.error(`[erro ${errorId}] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: "Erro interno", errorId });
}

module.exports = { HttpError, notFound, forbidden, notFoundHandler, errorHandler };
