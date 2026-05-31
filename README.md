# Bot Financeiro

Chatbot web/PWA de educacao financeira e mercado imobiliario com React, Node.js, Groq e historico de conversas.

## Rodar localmente

```bash
npm install
npm start
```

Acesse:

```text
http://localhost:3005
```

O `npm start` compila a interface React automaticamente antes de iniciar o servidor.

Para trabalhar apenas na interface com hot reload:

```bash
npm run dev:react
```

Nesse modo, deixe o backend rodando separadamente em outra porta se precisar testar as APIs.

## Deploy na Vercel

O projeto esta preparado para Vercel. No deploy, a Vercel executa `npm run build`, gera a pasta `dist/` e o Express entrega a interface React junto das rotas `/api`.

Configure as variaveis de ambiente do `.env.example` no painel da Vercel.

## Configurar Groq

Copie `.env.example` para `.env` e preencha:

```env
GROQ_API_KEY=sua_chave_groq
GROQ_MODEL=llama-3.3-70b-versatile
```

## Historico com Supabase

O app funciona sem login. Cada navegador recebe um identificador anonimo e as conversas ficam vinculadas a esse identificador.

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Execute o arquivo `supabase.sql`.
4. Execute tambem o arquivo `supabase-auth.sql` para habilitar login.
5. No arquivo `.env`, preencha:

```env
SUPABASE_URL=sua_url_do_supabase
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
APP_SESSION_SECRET=um_texto_grande_e_aleatorio
```

6. Reinicie o servidor.

Sem essas variaveis, o app continua funcionando parcialmente, mas login e historico em nuvem precisam do Supabase configurado.

## Seguranca

- Nunca suba o arquivo `.env` para o GitHub.
- Rotacione chaves que forem compartilhadas em chat, print ou video.
- A `SUPABASE_SERVICE_ROLE_KEY` deve ficar apenas no backend.
- O servidor aplica headers de seguranca, limite de requisicoes, validacao de origem e bloqueio de pedidos sobre arquivos internos, prompts, chaves e configuracoes.
