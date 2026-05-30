# Bot Financeiro

Chatbot web/PWA de educacao financeira com Node.js, Gemini e historico de conversas.

## Rodar localmente

```bash
npm install
npm start
```

Acesse:

```text
http://localhost:3005
```

## Configurar Gemini

No arquivo `.env`, preencha:

```env
GEMINI_API_KEY=sua_chave_gemini
```

## Historico com Supabase

O app funciona sem login. Cada navegador recebe um identificador anonimo e as conversas ficam vinculadas a esse identificador.

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Execute o arquivo `supabase.sql`.
4. No arquivo `.env`, preencha:

```env
SUPABASE_URL=sua_url_do_supabase
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
```

5. Reinicie o servidor.

Sem essas variaveis, o app continua funcionando com historico local no navegador.
