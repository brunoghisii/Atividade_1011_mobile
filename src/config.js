// IMPORTANTE: tudo que começa com EXPO_PUBLIC_ é embutido no app e qualquer pessoa consegue ler.
// Por isso aqui só existe a URL da API — nenhum segredo (chave, senha, JWT_SECRET) fica no app.
// Os segredos vivem apenas no servidor (server/.env, fora do git).
import Constants from "expo-constants";

// Em desenvolvimento, descobre o IP do computador que está rodando o Expo (o mesmo que roda a API).
// "localhost" não funciona em celular/emulador: lá, localhost é o próprio aparelho.
function devHostUrl() {
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost || "";
  const host = hostUri.split(":")[0];
  return host ? `http://${host}:3333` : "http://localhost:3333";
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? devHostUrl() : "")).replace(/\/+$/, "");

// Em build de produção, exige HTTPS para não trafegar dados de saúde/tokens em texto puro.
if (!__DEV__ && !API_URL.startsWith("https://")) {
  throw new Error("EXPO_PUBLIC_API_URL deve usar HTTPS em produção");
}

export const REQUEST_TIMEOUT_MS = 15000;
