# CONTEXT.md - Vestora Financeiro

## Resumo
Plataforma web/PWA de educação financeira com IA. Monolito JavaScript com frontend React/Vite e backend Express, deployado na Vercel. Chat suporta uso autenticado e anônimo; persistência em nuvem depende de Supabase.

## Stack
- Frontend: React 19, Vite 8, CSS puro, `react-markdown`, `remark-gfm`
- Backend: Express 4, `helmet`, `compression`, `express-rate-limit`, `cookie-parser`, `bcryptjs`
- Dados: Supabase/PostgreSQL opcional
- IA: Groq API (`groq.js`)
- Testes: Playwright + `node:test`

## Estrutura
```text
src/                  frontend React
  App.jsx             componente principal monolítico
  components/         UI reutilizável, anexos
public/               SW, manifest, ícones
api/                  entrypoint Vercel -> server.js
tests/                testes unitários e E2E
server.js             API, auth, chat, segurança
internetSearch.js     busca web, SSRF guards, snippets
officialFacts.js      fontes oficiais financeiras
groq.js               integração Groq
```

## Arquitetura
```text
Browser/PWA
  -> Express API/server.js
    -> Groq API
    -> Supabase
    -> internetSearch.js
    -> officialFacts.js
```

## Rotas principais
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/profile`
- `PATCH /api/auth/password`
- `GET /api/auth/sessions`
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `PATCH /api/conversations/:id`
- `DELETE /api/conversations/:id`
- `DELETE /api/conversations`
- `POST /api/chat`
- `POST /api/chat/stream`

## Auth e sessão
- Sessão autenticada: cookie assinado `vestora_session`
- CSRF: cookie `vestora_csrf` + header `x-csrf-token`
- Chat anônimo: permitido só nas rotas de chat via `requireChatAccess`
- Rotas de conta/conversas: continuam com `requireAuth` estrito

## Segurança atual
- CSP via `helmet` com `frame-ancestors 'none'`, `object-src 'none'`, `upgrade-insecure-requests` em produção
- Rate limiting:
  - API: 600/15min prod
  - Chat: 12/min
  - Auth: 8/15min
- Cookies: `httpOnly`, `sameSite`, `secure` em produção
- Anti prompt-injection para pedidos sensíveis
- SSRF hardening em `internetSearch.js`
- Sanitização de links de fontes no backend e frontend
- Handler de erro para JSON inválido sem stack trace

## Persistência
- Supabase configurado: perfil, auth e histórico em nuvem
- Sem Supabase ou chat anônimo: histórico fica em memória/local
- Frontend usa `localStorage` para:
  - device id
  - conversas locais
  - conversa atual
  - settings não sensíveis
  - rascunho da mensagem

## Configuração importante
```env
GROQ_API_KEY
GROQ_MODEL
GROQ_MAX_TOKENS
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APP_SESSION_SECRET
PORT
NODE_ENV
ALLOWED_ORIGINS
```

## Comandos úteis
```bash
npm run dev
npm run dev:react
npm run build
node --test tests/auth-access.test.js
npm run test:web-search
npx playwright test
```

## Arquivos para consultar primeiro
- `server.js`: auth, rotas, sessão, CSRF, headers
- `src/App.jsx`: fluxo do chat, auth modal, localStorage
- `internetSearch.js`: web search e SSRF defenses
- `tests/auth-access.test.js`: regressão de chat anônimo vs auth real

## Estado recente
- Commit de segurança recente: `1aa3df9`
- Branch atual usada no trabalho: `refactor/chatgpt-like-ui`
