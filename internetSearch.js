const SEARCH_TIMEOUT_MS = 12000;
const PAGE_FETCH_TIMEOUT_MS = 6000;
const MAX_RESULTS = 8;
const MAX_PAGE_SNIPPETS = 3;
const PRIORITY_DOMAINS = [
  "gov.br",
  "bcb.gov.br",
  "caixa.gov.br",
  "b3.com.br",
  "cvm.gov.br",
  "fgc.org.br",
  "receita.economia.gov.br",
  "receita.fazenda.gov.br",
  "investidor.b3.com.br",
  "tesourodireto.com.br",
  "serasa.com.br",
  "spcbrasil.org.br"
];

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(text) {
  return decodeHtml(
    String(text || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

async function readResponseText(response) {
  const contentType = response.headers.get("content-type") || "";
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  const buffer = await response.arrayBuffer();

  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      return new TextDecoder("latin1").decode(buffer);
    }
  }

  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  return utf8Text.includes("�") ? new TextDecoder("latin1").decode(buffer) : utf8Text;
}

function decodeBingTarget(value) {
  if (!value?.startsWith("a1")) return "";

  try {
    const encoded = value
      .slice(2)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function cleanSearchUrl(rawUrl) {
  const value = decodeHtml(rawUrl);

  try {
    const url = new URL(value, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    if (redirected) return decodeURIComponent(redirected);

    if (url.hostname.includes("bing.com") && url.pathname.includes("/ck/")) {
      const target = decodeBingTarget(url.searchParams.get("u"));
      if (target) return target;
    }

    return url.href;
  } catch {
    return value;
  }
}

function shouldPesquisarInternet(message) {
  const normalized = normalizeText(message);
  const clean = normalized.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  if (!clean || clean.length < 4) return false;

  const casualOnly = [
    "oi",
    "ola",
    "olá",
    "bom dia",
    "boa tarde",
    "boa noite",
    "tudo bem",
    "obrigado",
    "obrigada",
    "valeu"
  ];

  if (casualOnly.includes(clean)) return false;

  const currentTerms = [
    "atual",
    "hoje",
    "agora",
    "recente",
    "noticia",
    "noticias",
    "preco",
    "valor",
    "cotacao",
    "taxa",
    "regra",
    "lei",
    "2026",
    "2025",
    "empresa",
    "pessoa",
    "produto",
    "tecnologia",
    "selic",
    "cdi",
    "ipca",
    "tesouro",
    "fgc",
    "imposto",
    "financiamento",
    "financiamento imobiliario",
    "minha casa minha vida",
    "mcmv",
    "imovel",
    "imoveis",
    "quanto",
    "qual",
    "qual o valor",
    "quanto rende",
    "quanto custa",
    "qual a taxa",
    "qual a regra",
    "dolar",
    "dolar hoje",
    "euro",
    "bitcoin",
    "btc",
    "etf",
    "petr4",
    "vale3",
    "ibovespa",
    "bovespa",
    "salario minimo",
    "salario minimo 2026",
    "poupanca",
    "rendimento poupanca",
    "cdb",
    "lci",
    "lca",
    "fundo imobiliario",
    "fii",
    "acao",
    "acoes",
    "bolsa",
    "b3",
    "corretora",
    "nuinvest",
    "rico",
    "clear",
    "xp",
    "banco inter",
    "itau",
    "bradesco",
    "caixa",
    "santander",
    "programa habitacional",
    "minha casa",
    "faixa de renda",
    "renda familiar",
    "renda bruta",
    "comprometimento de renda",
    "juros",
    "juros atuais",
    "taxa de juros",
    "inflacao",
    "inflacao 2026",
    "igpm",
    "igpm 2026",
    "rentabilidade",
    "renda fixa",
    "renda variavel",
    "fundos",
    "previdencia",
    "previdencia privada",
    "seguro",
    "seguro de vida",
    "consorcio",
    "carta de credito",
    "emprestimo",
    "limite",
    "cartao de credito",
    "limite cartao",
    "anuidade",
    "milhas",
    "cashback",
    "nubank",
    "c6",
    "inter",
    "picpay",
    "mercado pago"
  ];

  const domainTerms = [
    "dinheiro",
    "invest",
    "renda",
    "reserva",
    "divida",
    "dívida",
    "orcamento",
    "orçamento",
    "financa",
    "finança",
    "imobili",
    "corretor",
    "compra",
    "venda",
    "aluguel",
    "juros",
    "salario",
    "salário",
    "programa",
    "governo",
    "banco",
    "parcela",
    "entrada",
    "renda bruta",
    "cripto",
    "criptomoeda",
    "pix",
    "ted",
    "doc",
    "boleto",
    "cheque",
    "seguro",
    "consorcio",
    "consórcio",
    "previdencia",
    "previdência",
    "declaracao",
    "declaração",
    "imposto de renda",
    "irpf",
    "cnh",
    "detran",
    "inss",
    "aposentadoria",
    "fgts",
    "pis",
    "pasep",
    "beneficio",
    "benefício",
    "bolsa familia",
    "bolsa família",
    "auxilio",
    "auxílio",
    "cadastro unico",
    "cadunico",
    "score",
    "serasa",
    "spc",
    "nome limpo",
    "negativado"
  ];

  const hasQuestionWord = /\b(quanto|qual|quais|como|quando|onde|por que|porque)\b/i.test(normalized);
  const hasMonetaryValue = /r\$|reais|\d+[.,]\d{2}/.test(message);

  return (
    currentTerms.some((term) => normalized.includes(term)) ||
    domainTerms.some((term) => normalized.includes(term)) ||
    clean.split(" ").length >= 3 ||
    (hasQuestionWord && clean.split(" ").length >= 2) ||
    hasMonetaryValue
  );
}

function buildSearchQueries(message) {
  const clean = String(message || "")
    .replace(/[?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return ["educacao financeira Brasil"];

  const normalized = normalizeText(clean);
  const queries = [];

  // Always include the exact message as the primary query
  queries.push(clean);

  if (normalized.includes("minha casa minha vida") || normalized.includes("mcmv")) {
    queries.push("Minha Casa Minha Vida faixas renda 2026");
    queries.push("MCMV limite renda urbana 2026");
  } else if (normalized.includes("salario minimo") || normalized.includes("salario mínimo")) {
    queries.push("valor salario minimo 2026");
    queries.push("salario minimo atual 2026");
  } else if (normalized.includes("selic") || normalized.includes("cdi") || normalized.includes("ipca") || normalized.includes("taxa de juros")) {
    queries.push("taxa selic atual banco central");
    queries.push("valor cdi hoje");
    queries.push("ipca acumulado 12 meses");
  } else if (normalized.includes("dolar") || normalized.includes("dólar") || normalized.includes("euro") || normalized.includes("cambio") || normalized.includes("cotacao")) {
    queries.push("cotacao dolar hoje");
    queries.push("cotacao euro hoje");
  } else if (normalized.includes("bitcoin") || normalized.includes("btc") || normalized.includes("cripto")) {
    queries.push("cotacao bitcoin hoje");
    queries.push("preco btc hoje reais");
  } else if (normalized.includes("ibovespa") || normalized.includes("bolsa") || normalized.includes("acao") || normalized.includes("ações")) {
    queries.push("ibovespa hoje");
    queries.push("ações b3 alta hoje");
  } else if (normalized.includes("fgts") || normalized.includes("inss") || normalized.includes("aposentadoria") || normalized.includes("bolsa familia")) {
    queries.push("tabela inss 2026");
    queries.push("regras fgts 2026");
    queries.push("calendario bolsa familia 2026");
  } else if (normalized.includes("imposto de renda") || normalized.includes("irpf") || normalized.includes("declaracao")) {
    queries.push("tabela imposto de renda 2026");
    queries.push("prazo declaracao irpf 2026");
  } else {
    // Add generic variations
    queries.push(`${clean} 2026`);
    queries.push(`${clean} atual`);
  }

  return [...new Set(queries)].slice(0, 3);
}

function getDomainScore(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const index = PRIORITY_DOMAINS.findIndex((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    return index >= 0 ? 100 - index : 0;
  } catch {
    return 0;
  }
}

function prioritizeResults(results) {
  return [...results]
    .map((result, index) => ({
      ...result,
      sourcePriority: getDomainScore(result.url),
      originalIndex: index
    }))
    .sort((a, b) => b.sourcePriority - a.sourcePriority || a.originalIndex - b.originalIndex)
    .slice(0, MAX_RESULTS)
    .map(({ originalIndex, ...result }) => result);
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isLikelySafePage(url) {
  const hostname = getHostname(url);
  if (!hostname) return false;

  return [
    "gov.br",
    "bcb.gov.br",
    "caixa.gov.br",
    "b3.com.br",
    "cvm.gov.br",
    "fgc.org.br",
    "receita.economia.gov.br",
    "receita.fazenda.gov.br"
  ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function findRelevantSnippet(text, query, size = 760) {
  const cleanText = stripHtml(text);
  const normalized = normalizeText(cleanText);
  const terms = normalizeText(query)
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !["2026", "site", "fonte", "oficial", "brasil"].includes(term));

  const index = terms
    .map((term) => normalized.indexOf(term))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];

  const start = index === undefined ? 0 : Math.max(0, index - Math.floor(size / 4));
  return cleanText.slice(start, start + size).trim();
}

async function fetchPageSnippet(url, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
      },
      signal: controller.signal
    });

    if (!response.ok) return "";

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return "";

    return findRelevantSnippet(await readResponseText(response), query);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichResultsWithPageSnippets(results, query) {
  const officialResults = results.filter((result) => isLikelySafePage(result.url)).slice(0, MAX_PAGE_SNIPPETS);

  const snippets = await Promise.all(
    officialResults.map(async (result) => ({
      url: result.url,
      pageSnippet: await fetchPageSnippet(result.url, query)
    }))
  );

  const snippetByUrl = new Map(
    snippets.filter((item) => item.pageSnippet).map((item) => [item.url, item.pageSnippet])
  );

  return results.map((result) => ({
    ...result,
    source: getHostname(result.url),
    pageSnippet: snippetByUrl.get(result.url) || undefined
  }));
}

async function searchWithPlaywright(query) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    });

    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });

    const results = await page.$$eval(".result", (nodes, maxResults) =>
      nodes.slice(0, maxResults).map((node) => {
        const titleElement = node.querySelector(".result__a");
        const snippetElement = node.querySelector(".result__snippet");
        return {
          title: titleElement?.textContent?.trim() || "",
          url: titleElement?.getAttribute("href") || "",
          snippet: snippetElement?.textContent?.trim() || ""
        };
      }),
      MAX_RESULTS
    );

    return prioritizeResults(results
      .filter((result) => result.title && result.url)
      .map((result) => ({
        ...result,
        url: cleanSearchUrl(result.url)
      })));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function searchWithFetch(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"'
  };

  try {
    const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: browserHeaders,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo retornou HTTP ${response.status}`);
    }

    const html = await readResponseText(response);
    const chunks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);


    return prioritizeResults(chunks
      .map((chunk) => {
        const linkMatch = chunk.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = chunk.match(/<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);

        if (!linkMatch) return null;

        return {
          title: stripHtml(linkMatch[2]),
          url: cleanSearchUrl(linkMatch[1]),
          snippet: stripHtml(snippetMatch?.[1] || "")
        };
      })
      .filter(Boolean)
      .filter((result) => result.title && result.url)
      .slice(0, MAX_RESULTS * 2));
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWithBing(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"'
  };

  try {
    const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: browserHeaders,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Bing retornou HTTP ${response.status}`);
    }

    const html = await readResponseText(response);
    const chunks = html.split(/<li[^>]+class="[^"]*b_algo[^"]*"[^>]*>/i).slice(1);

    return prioritizeResults(chunks
      .map((chunk) => {
        const linkMatch = chunk.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

        if (!linkMatch) return null;

        return {
          title: stripHtml(linkMatch[2]),
          url: cleanSearchUrl(linkMatch[1]),
          snippet: stripHtml(snippetMatch?.[1] || "")
        };
      })
      .filter(Boolean)
      .filter((result) => result.title && result.url)
      .slice(0, MAX_RESULTS * 2));
  } finally {
    clearTimeout(timeout);
  }
}

async function pesquisarInternet(message) {
  const queries = buildSearchQueries(message);
  const errors = [];

  for (const query of queries) {
    try {
      const results = await searchWithFetch(query);
      if (results.length > 0) {
        return {
          searched: true,
          engine: "DuckDuckGo",
          query,
          checkedAt: new Date().toISOString(),
          results: await enrichResultsWithPageSnippets(results, query)
        };
      }
    } catch (error) {
      errors.push(error.message);
    }

    try {
      const results = await searchWithBing(query);
      if (results.length > 0) {
        return {
          searched: true,
          engine: "Bing",
          query,
          checkedAt: new Date().toISOString(),
          results: await enrichResultsWithPageSnippets(results, query)
        };
      }
    } catch (error) {
      errors.push(error.message);
    }

    try {
      const results = await searchWithPlaywright(query);
      if (results.length > 0) {
        return {
          searched: true,
          engine: "DuckDuckGo",
          query,
          checkedAt: new Date().toISOString(),
          results: await enrichResultsWithPageSnippets(results, query)
        };
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    searched: true,
    engine: "DuckDuckGo",
    checkedAt: new Date().toISOString(),
    results: [],
    warning:
      "Nao foi possivel obter resultados suficientes na pesquisa online. Responda com incerteza e recomende confirmar em fonte oficial.",
    errors: errors.slice(0, 3)
  };
}

module.exports = {
  pesquisarInternet,
  shouldPesquisarInternet
};
