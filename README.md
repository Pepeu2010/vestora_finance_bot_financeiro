# Bot Financeiro

Chatbot web/PWA de educação financeira e mercado imobiliário com React, Node.js, Groq e histórico de conversas.

## Funcionalidades

- 💬 **Chat com IA** - Tire dúvidas sobre finanças, investimentos, imóveis e planejamento
- 📊 **Atalhos Rápidos** - Salário mínimo, dólar, Selic, FGTS, tabela IR, Bitcoin
- 🎤 **Entrada de Voz** - Fale em português brasileiro para fazer perguntas
- 🌙 **Tema Escuro/Light** - Troque entre modos claro e escuro
- 📱 **PWA** - Instale no celular como app nativo
- 🔒 **Seguro** - Headers de segurança, rate limiting, proteção contra XSS
- 🌍 **Multilingue** - Português, English, Español
- 💾 **Histórico** - Salve conversas localmente ou na nuvem (Supabase)
- 🔄 **Offline** - Funciona mesmo sem internet (PWA)
- ♿ **Acessível** - Navegação por teclado, leitores de tela

## Tecnologias

- **Frontend**: React 19 + Vite
- **Backend**: Express.js
- **IA**: Groq API (Llama model)
- **Banco**: Supabase (opcional)
- **Testes**: Playwright

## Rodar Localmente

```bash
npm install
npm start
```

Acesse: http://localhost:3005

O `npm start` compila a interface React automaticamente antes de iniciar o servidor.

Para trabalhar apenas na interface com hot reload:

```bash
npm run dev:react
```

## Deploy na Vercel

O projeto está preparado para Vercel. No deploy, a Vercel executa `npm run build`, gera a pasta `dist/` e o Express entrega a interface React junto das rotas `/api`.

Configure as variáveis de ambiente do `.env.example` no painel da Vercel.

## Configurar Groq

Copie `.env.example` para `.env` e preencha:

```env
GROQ_API_KEY=sua_chave_groq
GROQ_MODEL=llama-3.3-70b-versatile
```

## Histórico com Supabase

O app funciona sem login. Cada navegador recebe um identificador anônimo e as conversas ficam vinculadas a esse identificador.

1. Crie um projeto no Supabase
2. Abra o SQL Editor
3. Execute o arquivo `supabase.sql`
4. Execute também o arquivo `supabase-auth.sql` para habilitar login
5. No arquivo `.env`, preencha:

```env
SUPABASE_URL=sua_url_do_supabase
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
APP_SESSION_SECRET=um_texto_grande_e_aleatorio
```

6. Reinicie o servidor

Sem essas variáveis, o app continua funcionando parcialmente, mas login e histórico em nuvem precisam do Supabase configurado.

## Testes

Execute todos os testes:

```bash
npx playwright test
```

Execute com relatório detalhado:

```bash
npx playwright test --reporter=list
```

Execute apenas testes de interface:

```bash
npx playwright test tests/ui.spec.js
npx playwright test tests/button-functions.spec.js
npx playwright test tests/e2e-flows.spec.js
```

## Segurança

- Nunca suba o arquivo `.env` para o GitHub
- Rotacione chaves que forem compartilhadas em chat, print ou vídeo
- A `SUPABASE_SERVICE_ROLE_KEY` deve ficar apenas no backend
- O servidor aplica headers de segurança, limite de requisições, validação de origem e bloqueio de pedidos sobre arquivos internos, prompts, chaves e configurações

## Estrutura do Projeto

```
bot-financeiro/
├── src/
│   ├── App.jsx      # Componente principal
│   ├── main.jsx      # Entry point React
│   └── style.css     # Estilos globais
├── public/
│   ├── sw.js         # Service Worker (PWA)
│   └── manifest.json # Manifesto PWA
├── server.js         # Backend Express
├── api/
│   └── index.js      # Rotas da API
├── groq.js           # Integração Groq
├── supabase.js       # Cliente Supabase
├── prompts.js        # Prompts do sistema
└── tests/            # Testes Playwright
```

## Licença

MIT