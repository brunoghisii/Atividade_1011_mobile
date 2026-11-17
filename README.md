# Consultório — App mobile + API

Sistema para o dia a dia de um consultório/clínica: agenda, recepção, atendimento, prontuário,
anexos e caixa do dia. App em **React Native (Expo)** e API em **Node.js/Express + SQLite**.

## Arquitetura

```
┌────────────────────────┐   HTTPS + Bearer token   ┌──────────────────────────────────┐
│  App Expo (este repo)  │ ───────────────────────▶ │  API  (server/)                  │
│  - validação de UX     │                          │  helmet → CORS → rate limit      │
│  - tokens no SecureStore│ ◀─────────────────────── │  → JSON 100kb → auth JWT → RBAC  │
│  - nenhum segredo      │      JSON sem detalhes   │  → validação zod → regras/IDOR   │
└────────────────────────┘      técnicos            │  → SQLite (prepared statements)  │
                                                    │  uploads fora de pasta pública   │
                                                    └──────────────────────────────────┘
```

```
App.js                   tema, sessão, abas (Agenda · Pacientes · Ajustes)
src/api.js               cliente HTTP: SecureStore, refresh automático, timeout
src/validation.js        validações/máscaras do frontend (CPF, telefone, datas, senha)
src/ui.js                snackbar, confirmação, useSubmit (bloqueia envio duplo)
src/screens/             Login, Agenda, Nova consulta, Pacientes, Ficha, Ajustes
server/src/app.js        pipeline de middlewares de segurança
server/src/security/     auth (JWT/bcrypt/lockout), validate (zod), rateLimit, errors
server/src/routes/       auth, users, patients, appointments, records, attachments
server/test/             testes automatizados de segurança e regras de negócio
```

## Funcionalidades

| Papel | Pode |
|---|---|
| **Recepção** | Cadastrar/editar pacientes, agendar/remarcar, confirmar presença, marcar falta/cancelar, registrar pagamento (PIX, dinheiro, cartão, convênio), anexar documentos, chamar no WhatsApp |
| **Profissional** | Ver **só a própria** agenda, iniciar/finalizar atendimento, registrar evolução no prontuário (imutável), ver anexos dos **seus** pacientes |
| **Admin** | Tudo da recepção + gestão da equipe (criar, trocar papel, desativar, resetar senha) + leitura de prontuários |

- Agenda por dia com resumo: total, a atender, concluídas, faltas, recebido e a receber.
- Bloqueio de **conflito de horário** (mesmo profissional ou mesmo paciente) e expediente 06:00–22:00.
- Fluxo de status controlado: agendado → confirmado → em atendimento → concluído (ou falta/cancelado, com reativação).
- Ficha do paciente: dados, histórico de consultas, prontuário e anexos (PDF/PNG/JPEG até 5 MB).
- Auditoria: login, leitura de prontuário, downloads, alterações ficam em `audit_log`.

## Como rodar

### 1. API
```bash
cd server
npm install
cp .env.example .env
# gere o segredo e cole em JWT_SECRET no .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
ADMIN_PASSWORD="SuaSenha#Forte1" npm run create-admin -- "Seu Nome" voce@clinica.com
npm start          # porta 3333
npm test           # testes de segurança
```
Requer Node 22.13+ (usa o SQLite nativo do Node).

### 2. App
```bash
npm install
cp .env.example .env     # ajuste EXPO_PUBLIC_API_URL (no celular físico use o IP da máquina)
npx expo start
```
Entre com o admin criado e cadastre a equipe em **Ajustes → Equipe**.

## Checklist de segurança

| Regra | Como foi tratada | Onde |
|---|---|---|
| **.env exposta** | `.env` no `.gitignore` (app e server); só `.env.example` versionado. O app só tem `EXPO_PUBLIC_API_URL` (pública por natureza) — nenhum segredo no bundle. Servidor não sobe sem `JWT_SECRET` ≥ 32 chars. | `.gitignore`, `src/config.js`, `server/src/config.js` |
| **Validação frontend** | Validação + máscaras em todos os formulários (CPF com dígito verificador, telefone, datas, horário, senha forte, tamanho de arquivo/tipo). | `src/validation.js`, telas |
| **Validação backend** | Todo `body`/`query`/`params` validado com zod em modo *strict* (campos extras rejeitados → sem mass assignment). Regras de negócio revalidadas no servidor. | `server/src/security/validate.js` |
| **SQL injection** | 100% prepared statements com `?`; `LIKE` com escape de `%`/`_`. Teste com `' OR 1=1 --`. | `server/src/db.js`, rotas |
| **Autenticação fraca** | Senha forte obrigatória (10+, maiúscula, minúscula, número, símbolo). Sem usuário/senha padrão. JWT HS256 com algoritmo fixo (bloqueia `alg:none`), `issuer` e expiração. | `security/auth.js` |
| **Exposição IDOR** | IDs UUID (não sequenciais) **e** checagem de posse em cada objeto: profissional só acessa a própria agenda e prontuários/anexos de pacientes que atende; anexo é conferido contra o paciente da URL. Resposta 404 (não confirma existência). | `routes/appointments.js`, `records.js`, `attachments.js` |
| **Senhas direto no banco** | bcrypt custo 12; refresh tokens guardados só como hash SHA-256. | `security/auth.js` |
| **Ataque de força bruta** | Rate limit no login (10/15 min por IP) **+** bloqueio da conta por 15 min após 5 erros (pega ataque distribuído). Tempo de resposta constante para e-mail inexistente. | `security/rateLimit.js`, `security/auth.js` |
| **Bloquear durante envio** | `useSubmit` com trava (ref) — impossível disparar a mesma ação duas vezes; botões e campos ficam `disabled` + `loading`. No servidor, agendamento em transação `BEGIN IMMEDIATE` contra corrida. | `src/ui.js`, `server/src/db.js` |
| **CSRF** | Autenticação por header `Authorization: Bearer` (nunca cookie). O navegador não envia esse header sozinho, então não há vetor de CSRF. CORS também não permite credenciais. | `security/auth.js`, `app.js` |
| **Upload sem validação** | Limite 5 MB, 1 arquivo, tipo verificado pelos **magic bytes** (PDF/PNG/JPEG), nome salvo = UUID fora de pasta pública, nome original sanitizado (sem path traversal), download autenticado com `Content-Disposition: attachment` + `nosniff`, rate limit de upload. | `routes/attachments.js` |
| **Revelando info** | `x-powered-by` removido; erro 500 devolve só `{"error":"Erro interno","errorId"}` (detalhe só no log); login com mensagem única; contas bloqueadas não revelam existência. | `security/errors.js`, `app.js` |
| **Dependências vulneráveis** | Removidas libs não usadas (`expo-location`, `expo-sqlite`); `npm audit fix` aplicado; API com **0 vulnerabilidades**; script `npm run audit`. Ver nota abaixo. | `package.json` |
| **Tokens mal otimizados** | Access token de 15 min com payload mínimo (id, papel, versão); refresh de 7 dias com **rotação** e **detecção de reuso** (revoga a família inteira). `token_version` derruba sessões na hora ao trocar senha/desativar usuário. Tokens no SecureStore (Keychain/Keystore). | `security/auth.js`, `src/api.js` |
| **Rate limit** | Global 300 req/min por IP, login 10/15 min, upload 60/h. `TRUST_PROXY` para IP real atrás de proxy. | `security/rateLimit.js` |
| **Dados sensíveis expostos** | Prontuário bloqueado para recepção; profissional não vê financeiro; `Cache-Control: no-store` em todas as respostas; nada de dados de saúde salvo no aparelho (removido o SQLite local); Android `allowBackup: false`; HTTPS obrigatório em build de produção; auditoria de acesso. | `routes/*`, `app.json`, `src/config.js` |
| **SSRF** | A API nunca faz requisições para URLs vindas do usuário (não existe "buscar imagem por URL" etc.). O único link externo é montado no app (`wa.me/55` + só dígitos). Se for criar algo assim no futuro, use allowlist de domínios e bloqueie IPs internos. | — |
| **Cookies inseguros** | A API não emite cookies. Se um painel web for adicionado, usar `HttpOnly; Secure; SameSite=Strict`. | — |
| **CORS** | Allowlist explícita em `CORS_ORIGINS`, só métodos/headers necessários, `credentials: false`. Origem desconhecida recebe 403. | `app.js` |

### Nota sobre `npm audit` do app
As vulnerabilidades restantes no app (`picomatch`, `minimatch`) estão no **tooling de build** do Expo
(metro/CLI), não no código que vai para o celular. A única correção oferecida pelo npm é rebaixar para
o Expo 50, o que não faz sentido. Acompanhe as atualizações do SDK com `npx expo install --fix`.

### Para produção
- Coloque a API atrás de um proxy com **HTTPS** (nginx/Caddy) e `NODE_ENV=production`, `TRUST_PROXY=1`.
- Faça backup diário de `server/data/` (banco + anexos) criptografado.
- Rode `npm run audit` periodicamente nos dois projetos.
