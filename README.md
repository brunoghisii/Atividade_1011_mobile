# Consultório — App mobile + API

Sistema para o dia a dia de uma clínica (com foco em fisioterapia), com **duas áreas no mesmo app**:

- **Área da clínica**: agenda, recepção, atendimento, prontuário, planos de tratamento, anexos e caixa do dia.
- **Área do paciente**: agendar sessões, confirmar/cancelar, acompanhar o progresso do tratamento e ler as orientações do profissional.

Na tela de login a pessoa escolhe **"Sou paciente"** ou **"Sou da clínica"**. App em **React Native (Expo)** e API em **Node.js/Express + SQLite**.

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
server/src/routes/       auth, users, patients, appointments, records, attachments, plans,
                         portalAccounts (acesso do paciente), portal (API do paciente)
src/screens/portal/      telas do paciente: Início, Agendar, Sessões, Conta, Primeiro acesso
server/test/             testes automatizados de segurança e regras de negócio
```

## Funcionalidades

| Papel | Pode |
|---|---|
| **Recepção** | Cadastrar/editar pacientes, agendar/remarcar, confirmar presença, marcar falta/cancelar, registrar pagamento (PIX, dinheiro, cartão, convênio), anexar documentos, chamar no WhatsApp |
| **Profissional** | Ver **só a própria** agenda, iniciar/finalizar atendimento, registrar evolução no prontuário (imutável), ver anexos dos **seus** pacientes |
| **Admin** | Tudo da recepção + gestão da equipe (criar, trocar papel, desativar, resetar senha) + leitura de prontuários |
| **Paciente** | Agendar sessão (só vê horários livres), confirmar presença, cancelar até 12h antes, ver progresso do plano ("6 de 10 sessões"), histórico de sessões e orientações do profissional |

### Fluxo da fisioterapia
1. Recepção cadastra o paciente e, na ficha, clica em **Criar acesso** (e-mail + senha provisória).
2. Profissional cria o **Plano** (ex.: "Reabilitação de joelho", 10 sessões, objetivo).
3. Paciente entra no app, troca a senha provisória (obrigatório) e agenda as sessões — elas entram
   automaticamente no plano ativo com aquele profissional e aparecem na agenda com o selo "Agendado pelo app".
4. Ao atender, o profissional conclui a sessão e envia uma **Orientação ao paciente** (exercícios, cuidados).
5. O paciente vê a barra de progresso subir e a orientação na tela inicial.

Regras do agendamento pelo paciente: seg–sex, 08h–18h, sessões de 1h, mínimo 2h de antecedência,
até 60 dias à frente e no máximo 3 consultas em aberto.

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
npx expo start
```
Entre com o admin criado (em "Sou da clínica") e cadastre a equipe em **Ajustes → Equipe**.

Em desenvolvimento o app descobre sozinho o IP do computador que roda o Expo e usa a API na porta
3333 dele. Só crie o `.env` (`EXPO_PUBLIC_API_URL`) se a API estiver em **outra** máquina.

### "Sem conexão com o servidor"?
A mensagem mostra o endereço que o app tentou. Verifique:
1. A API está rodando (`npm start` em `server/`) — ao subir ela mostra "Acesse pela rede em: http://IP:3333".
2. Celular e computador estão **na mesma rede Wi-Fi** (rede de visitante/faculdade costuma isolar aparelhos).
3. O **Firewall do Windows** libera a porta 3333. No PowerShell como administrador:
   `New-NetFirewallRule -DisplayName "API Consultorio" -Direction Inbound -Protocol TCP -LocalPort 3333 -Action Allow`
4. Abra `http://IP:3333/health` no navegador do celular — deve aparecer `{"ok":true}`.
5. Se usou `npx expo start --tunnel`, a detecção automática não funciona: defina `EXPO_PUBLIC_API_URL`.

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

### Segurança entre a área do paciente e a da clínica
| Risco | Proteção |
|---|---|
| Paciente usar o token para acessar rotas da clínica (ou o contrário) | Contas em **tabelas separadas** (`users` × `patient_accounts`) e JWT com `audience` diferente (`staff` × `patient`); cada middleware rejeita o token da outra área. Testado. |
| Paciente ver dados de outro paciente (IDOR) | Nenhuma rota do portal recebe `patient_id`: o paciente é identificado **só pelo token**. Ações em consulta exigem `id` **e** `patient_id` do próprio token (senão 404). Campos extras como `patient_id` no body são rejeitados. |
| Paciente ver prontuário, preços ou dados internos | Respostas do portal com colunas explícitas: sem prontuário, sem valores, sem ids de usuários. A disponibilidade devolve **só horários livres**, nunca quem ocupa os outros. Profissional escreve uma "orientação ao paciente" separada do prontuário. |
| Senha provisória fraca/compartilhada | Recepção define senha forte provisória; o paciente é **bloqueado** (403) até trocá-la, e a troca revoga todas as sessões anteriores. |
| Abuso do agendamento (lotar a agenda) | Máx. 3 consultas em aberto, antecedência mínima/máxima, grade fixa de horários, rate limit de 20 agendamentos/h, transação contra corrida. |
| Força bruta no login do paciente | Mesmo rate limit + bloqueio de conta após 5 erros da equipe. |
| Paciente desligado da clínica | Recepção pode **bloquear** o acesso (derruba as sessões na hora); paciente inativo não consegue logar. |

### Nota sobre `npm audit` do app
As vulnerabilidades restantes no app (`picomatch`, `minimatch`) estão no **tooling de build** do Expo
(metro/CLI), não no código que vai para o celular. A única correção oferecida pelo npm é rebaixar para
o Expo 50, o que não faz sentido. Acompanhe as atualizações do SDK com `npx expo install --fix`.

### Para produção
- Coloque a API atrás de um proxy com **HTTPS** (nginx/Caddy) e `NODE_ENV=production`, `TRUST_PROXY=1`.
- Faça backup diário de `server/data/` (banco + anexos) criptografado.
- Rode `npm run audit` periodicamente nos dois projetos.
