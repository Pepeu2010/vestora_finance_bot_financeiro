# SECURITY_AUDIT.md - Vestora Financeiro

## Escopo
Auditoria passiva do código para reduzir contexto repetido em futuras revisões. Foco em app security, auth, sessão, API, frontend e integrações externas.

## Estado atual
- Score estimado após correções recentes: `72/100`
- Dependências com `npm audit`: `0 vulnerabilidades conhecidas`
- Última rodada de correções relevantes: commit `1aa3df9`

## Correções já aplicadas

### 1. Isolamento de auth anônima do chat
- Antes: fallback anônimo estava dentro de `requireAuth`
- Agora:
  - `requireAuth` protege apenas rotas autenticadas
  - `requireChatAccess` permite uso anônimo só em `/api/chat` e `/api/chat/stream`

### 2. CSP corrigida
- Antes: header de produção podia sobrescrever a CSP do Helmet
- Agora: `upgrade-insecure-requests` é parte da config do Helmet

### 3. Links de fontes sanitizados
- Backend normaliza URLs para `http/https`
- Frontend usa `safeExternalHref()` também em `MessageSources`

### 4. Erros de JSON endurecidos
- JSON inválido retorna `400 { error: "JSON invalido." }`
- Evita vazamento de stack trace em parsing failure

### 5. SSRF endurecido
- `internetSearch.js` bloqueia:
  - localhost
  - RFC1918 IPv4
  - metadata IPs
  - usernames/passwords em URL
  - IPv6 local/link-local/ULA básicos

### 6. Menos dados sensíveis em localStorage
- Persistência limitada a settings não sensíveis
- Campos pessoais/customizados deixaram de ser serializados no storage local

## Riscos remanescentes

### Alto
- Backend usa `SUPABASE_SERVICE_ROLE_KEY`
- Impacto: qualquer bug de autorização no backend tem blast radius alto
- Recomendação: migrar operações user-scoped para token de usuário quando possível

### Médio
- Sessão é cookie assinado autocontido, sem revogação real por `jti`
- Logout limpa cookie do cliente, mas não invalida sessão server-side
- Recomendação: session store + revogação por `jti`

### Médio
- Há conteúdo financeiro e histórico ainda persistido localmente em conversas anônimas
- Recomendação: modo privativo opcional ou TTL local

### Médio
- SSRF ainda não faz resolução DNS com validação de IP final
- Recomendação: validar IPs resolvidos antes do fetch externo

### Baixo
- Uploads ainda são apenas metadados client-side
- Se virar upload real no backend, será necessário validar MIME, magic bytes e storage isolado

## Controles existentes
- Helmet
- CSP
- `frame-ancestors 'none'`
- Rate limits
- CSRF por double-cookie
- Cookies `httpOnly` para sessão
- `sameSite` e `secure` em produção
- Sanitização de resposta do modelo
- Anti prompt-injection
- SSRF guards

## Testes de segurança relevantes
- `tests/auth-access.test.js`
  - chat anônimo permitido
  - rota autenticada continua 401 sem login
  - JSON inválido não vaza stack

## Próximas prioridades
1. Reduzir dependência de `service_role`
2. Implementar revogação real de sessão
3. Adicionar validação DNS/IP final para SSRF
4. Criar testes adicionais para headers/CSP e links inseguros
5. Adicionar política de retenção para conversas locais

## Arquivos críticos para auditoria futura
- `server.js`
- `internetSearch.js`
- `src/App.jsx`
- `supabase.js`
- `supabase.sql`
- `tests/auth-access.test.js`
