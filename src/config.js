// IMPORTANTE: tudo que começa com EXPO_PUBLIC_ é embutido no app e qualquer pessoa consegue ler.
// Por isso aqui só existe a URL da API — nenhum segredo (chave, senha, JWT_SECRET) fica no app.
// Os segredos vivem apenas no servidor (server/.env, fora do git).
const DEFAULT_URL = "http://localhost:3333";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_URL).replace(/\/+$/, "");

// Em build de produção, exige HTTPS para não trafegar dados de saúde/tokens em texto puro.
if (!__DEV__ && !API_URL.startsWith("https://")) {
  throw new Error("EXPO_PUBLIC_API_URL deve usar HTTPS em produção");
}

export const REQUEST_TIMEOUT_MS = 15000;
