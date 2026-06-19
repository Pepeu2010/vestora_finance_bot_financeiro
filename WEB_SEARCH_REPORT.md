# Relatorio de correcao da pesquisa web

## Problemas encontrados

1. A deteccao de perguntas que precisavam de dados atuais estava errada:
   - `shouldPesquisarInternet()` retornava `true` para quase qualquer pergunta com 3 palavras ou mais.
   - Isso fazia a aplicacao pesquisar sem necessidade e nao distinguia pergunta estavel de pergunta temporal.

2. A busca dependia demais de um fluxo fragil:
   - Scraping principal de DuckDuckGo/Bing sem camada central de fallback.
   - Sem coordenacao de cache por categoria de consulta.
   - Sem reaproveitamento de buscas iguais em andamento.

3. Faltava governanca operacional:
   - Logs existiam no servidor, mas nao eram estruturados.
   - Nao havia classificacao clara do motivo da busca.
   - Nao havia teste dedicado para cache, fallback e busca real.

4. A interface ainda podia exibir fontes para o usuario:
   - O requisito pedia mostrar apenas a resposta final.

## O que foi corrigido

### Backend de busca

- Reescrita de `internetSearch.js` com:
  - classificador de atualidade por categoria (`finance`, `news`, `sports`, `weather`, `current-affairs`, `rules`, `educational`, `stable`);
  - TTL de cache por tipo de pergunta;
  - deduplicacao de resultados;
  - priorizacao de dominios oficiais e altamente confiaveis;
  - timeout global e timeout por provedor;
  - reaproveitamento de pesquisas identicas em andamento;
  - logs estruturados de sucesso, falha, cache hit e skip.

- Fallback robusto entre provedores:
  - `duckduckgo-html`
  - `duckduckgo-lite`
  - `bing`
  - `google-news-rss` para consultas de noticias
  - `playwright` como ultimo recurso controlado

- Enriquecimento com dados de tempo real para cotacoes:
  - dolar via Banco Central / AwesomeAPI
  - euro via AwesomeAPI
  - bitcoin via CoinGecko

### Integracao do chat

- `server.js` agora:
  - classifica a pergunta antes da resposta;
  - obriga pesquisa web quando a pergunta exige dado atual;
  - registra o motivo da classificacao;
  - mantem a resposta resiliente mesmo quando a pesquisa falha.

### Interface

- `src/App.jsx` foi ajustado para nao renderizar fontes ao usuario final.

### Testes

- Novo teste dedicado: `tests/internet-search.test.js`
  - classificador temporal
  - classificador estavel
  - cache
  - fallback para Bing
  - busca real na internet com `RUN_WEB_LIVE_TESTS=1`

- Novo script:
  - `npm run test:web-search`

## Validacao executada

- `npm run test:web-search`
- `RUN_WEB_LIVE_TESTS=1 npm run test:web-search`
- `npm run build`

## Evidencias de busca real

- Pergunta testada: `Qual a cotacao do dolar hoje?`
  - resultado real obtido durante a execucao;
  - cotacao enriquecida com dado atual em tempo real;
  - busca priorizou fonte oficial/Banco Central.

- Pergunta testada: `Quem e o presidente do Brasil atualmente?`
  - resultado real obtido durante a execucao;
  - fonte oficial priorizada: `gov.br`.

- Pergunta testada: `Explique o que e reserva de emergencia.`
  - busca corretamente ignorada por ser pergunta estavel.
