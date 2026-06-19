const SEARCH_TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS || 12000);
const PROVIDER_TIMEOUT_MS = Number(process.env.WEB_SEARCH_PROVIDER_TIMEOUT_MS || 5000);
const PAGE_FETCH_TIMEOUT_MS = Number(process.env.WEB_SEARCH_PAGE_TIMEOUT_MS || 4000);
const REALTIME_TIMEOUT_MS = Number(process.env.REALTIME_TIMEOUT_MS || 6000);
const MAX_RESULTS = Number(process.env.WEB_SEARCH_MAX_RESULTS || 5);
const MAX_PAGE_SNIPPETS = Number(process.env.WEB_SEARCH_PAGE_SNIPPETS || 5);
const MAX_QUERIES = 4;
const WEB_SEARCH_CACHE_TTL_MS = Number(process.env.WEB_SEARCH_CACHE_TTL_MS || 15 * 60 * 1000);
const SEARXNG_BASE_URL = String(process.env.SEARXNG_BASE_URL || process.env.SEARXNG_URL || "").trim();
const ENABLE_DDG_PROVIDER = process.env.ENABLE_DDG_PROVIDER !== "false";
const ENABLE_SEARXNG_PROVIDER = process.env.ENABLE_SEARXNG_PROVIDER !== "false";
const ENABLE_PLAYWRIGHT_PROVIDER = process.env.ENABLE_PLAYWRIGHT_PROVIDER !== "false";
const COMMODITIES_API_URL = process.env.COMMODITIES_API_URL || "";
const COMMODITIES_API_KEY = process.env.COMMODITIES_API_KEY || "";

const PRIORITY_DOMAINS = [
  "gov.br",
  "bcb.gov.br",
  "caixa.gov.br",
  "b3.com.br",
  "cvm.gov.br",
  "fgc.org.br",
  "receita.economia.gov.br",
  "receita.fazenda.gov.br",
  "tesourodireto.com.br",
  "inmet.gov.br",
  "ibge.gov.br",
  "planalto.gov.br",
  "stf.jus.br",
  "tse.jus.br",
  "who.int",
  "nasa.gov"
];

const SEARCH_CACHE = new Map();
const IN_FLIGHT_SEARCHES = new Map();

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function logSearch(level, event, details = {}) {
  const payload = {
    scope: "web-search",
    event,
    ...details,
    at: new Date().toISOString()
  };

  const line = `[web-search] ${JSON.stringify(payload)}`;

  if (level === "warn") {
    console.warn(line);
    return;
  }

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
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

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSearchEngineInternalUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");

    if (hostname === "duckduckgo.com" || hostname === "lite.duckduckgo.com") {
      return true;
    }

    if (hostname === "bing.com" && parsed.pathname.startsWith("/ck/")) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function getDomainScore(url) {
  const hostname = getHostname(url);
  if (!hostname) return 0;

  const index = PRIORITY_DOMAINS.findIndex(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );

  return index >= 0 ? 100 - index : 0;
}

function isLikelySafePage(url) {
  const hostname = getHostname(url);
  if (!hostname) return false;

  return PRIORITY_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

function dedupeResults(results) {
  const seen = new Set();

  return results.filter((result) => {
    const url = cleanSearchUrl(result.url);
    const comparable = getComparableUrl(url);
    if (!url || !comparable || isSearchEngineInternalUrl(url) || seen.has(comparable)) return false;
    seen.add(comparable);
    result.url = url;
    return Boolean(result.title);
  });
}

function getComparableUrl(rawUrl) {
  try {
    const parsed = new URL(cleanSearchUrl(rawUrl));
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    parsed.searchParams.delete("utm_term");
    parsed.searchParams.delete("utm_content");
    parsed.searchParams.delete("gclid");
    parsed.searchParams.delete("fbclid");
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.hostname.replace(/^www\./, "")}${pathname}${parsed.search ? `?${parsed.searchParams.toString()}` : ""}`;
  } catch {
    return "";
  }
}

function prioritizeResults(results) {
  return dedupeResults(results)
    .map((result, index) => ({
      ...result,
      source: result.source || getHostname(result.url),
      sourcePriority: getDomainScore(result.url),
      originalIndex: index
    }))
    .sort((a, b) => b.sourcePriority - a.sourcePriority || a.originalIndex - b.originalIndex)
    .slice(0, MAX_RESULTS)
    .map(({ originalIndex, ...result }) => result);
}

function shouldSearchForFreshness(message) {
  return classifyFreshnessNeed(message).shouldSearch;
}

function classifyFreshnessNeed(message) {
  const original = String(message || "").trim();
  const normalized = normalizeText(original);
  const clean = normalized.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  if (!clean || clean.length < 4) {
    return {
      shouldSearch: false,
      category: "none",
      reason: "empty-or-too-short",
      confidence: 0,
      cacheTtlMs: 0
    };
  }

  const educationalPatterns = [
    /^o que e\b/,
    /^o que significa\b/,
    /^explique\b/,
    /^me explique\b/,
    /^como funciona\b/,
    /^qual a diferenca\b/,
    /^quais sao os tipos\b/,
    /^dicas para\b/
  ];

  const realtimeTerms = [
    "agora",
    "hoje",
    "atual",
    "atualmente",
    "recente",
    "recentes",
    "ultima",
    "ultimas",
    "ultimo",
    "ultimos",
    "neste momento",
    "nesse momento",
    "ao vivo",
    "tempo real",
    "acabou de",
    "2026",
    "2025"
  ];

  const categoryRules = [
    {
      category: "news",
      ttlMs: 5 * 60 * 1000,
      patterns: ["noticia", "noticias", "manchete", "evento", "aconteceu", "acontecendo", "ultimas do mercado"]
    },
    {
      category: "finance",
      ttlMs: 2 * 60 * 1000,
      patterns: [
        "cotacao",
        "cotacao",
        "preco",
        "precos",
        "valor",
        "taxa",
        "selic",
        "cdi",
        "ipca",
        "igpm",
        "dolar",
        "euro",
        "bitcoin",
        "btc",
        "ethereum",
        "acao",
        "acoes",
        "fii",
        "fundo imobiliario",
        "etf",
        "ibovespa",
        "petr4",
        "vale3"
      ]
    },
    {
      category: "sports",
      ttlMs: 5 * 60 * 1000,
      patterns: ["jogo", "placar", "resultado", "campeonato", "classificacao", "classificação", "rodada", "gol", "partida"]
    },
    {
      category: "weather",
      ttlMs: 10 * 60 * 1000,
      patterns: ["clima", "tempo", "chuva", "temperatura", "previsao", "previsão", "frente fria"]
    },
    {
      category: "current-affairs",
      ttlMs: 15 * 60 * 1000,
      patterns: [
        "presidente",
        "governador",
        "prefeito",
        "ministro",
        "ceo",
        "diretor",
        "empresa",
        "quem e",
        "quem é",
        "foi eleito",
        "cargo",
        "mandato"
      ]
    },
    {
      category: "rules",
      ttlMs: 30 * 60 * 1000,
      patterns: [
        "regra",
        "regras",
        "lei",
        "legislacao",
        "legislação",
        "imposto",
        "irpf",
        "fgts",
        "inss",
        "beneficio",
        "benefício",
        "salario minimo",
        "minha casa minha vida",
        "mcmv",
        "programa habitacional",
        "documentacao oficial",
        "documentação oficial"
      ]
    }
  ];

  const matchedRule = categoryRules.find((rule) =>
    rule.patterns.some((pattern) => normalized.includes(normalizeText(pattern)))
  );

  const hasRealtimeTerm = realtimeTerms.some((term) => normalized.includes(term));
  const likelyEducational = educationalPatterns.some((pattern) => pattern.test(clean));

  if (matchedRule) {
    return {
      shouldSearch: true,
      category: matchedRule.category,
      reason: hasRealtimeTerm ? "explicit-freshness-term" : `dynamic-category:${matchedRule.category}`,
      confidence: hasRealtimeTerm ? 1 : 0.86,
      cacheTtlMs: matchedRule.ttlMs
    };
  }

  if (hasRealtimeTerm) {
    return {
      shouldSearch: true,
      category: "general-fresh",
      reason: "explicit-freshness-term",
      confidence: 0.8,
      cacheTtlMs: 15 * 60 * 1000
    };
  }

  if (likelyEducational) {
    return {
      shouldSearch: false,
      category: "educational",
      reason: "stable-explanatory-question",
      confidence: 0.08,
      cacheTtlMs: 0
    };
  }

  return {
    shouldSearch: false,
    category: "stable",
    reason: "no-temporal-signal",
    confidence: 0.05,
    cacheTtlMs: 0
  };
}

function buildSearchQueries(message, classification) {
  const clean = String(message || "")
    .replace(/[?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return ["educacao financeira brasil"];

  const normalized = normalizeText(clean);
  const queries = [clean];

  if (classification.category === "news") {
    queries.push(`${clean} ultimas noticias`);
    queries.push(`${clean} site oficial`);
  } else if (classification.category === "sports") {
    queries.push(`${clean} placar hoje`);
    queries.push(`${clean} resultado oficial`);
  } else if (classification.category === "weather") {
    queries.push(`${clean} previsao hoje`);
    queries.push(`${clean} inmet`);
  } else if (normalized.includes("minha casa minha vida") || normalized.includes("mcmv")) {
    queries.push("Minha Casa Minha Vida renda atual gov br");
    queries.push("CAIXA Minha Casa Minha Vida regras atuais");
  } else if (normalized.includes("selic") || normalized.includes("cdi") || normalized.includes("ipca")) {
    queries.push(`${clean} banco central`);
    queries.push(`${clean} gov br`);
  } else if (normalized.includes("dolar") || normalized.includes("dólar") || normalized.includes("euro")) {
    queries.push(`${clean} banco central`);
    queries.push(`${clean} cotacao oficial`);
  } else if (normalized.includes("bitcoin") || normalized.includes("btc") || normalized.includes("ethereum")) {
    queries.push(`${clean} coingecko`);
    queries.push(`${clean} coinmarketcap`);
  } else if (classification.category === "current-affairs") {
    queries.push(`${clean} gov br`);
    queries.push(`${clean} wikipedia`);
  } else if (classification.category === "rules") {
    queries.push(`${clean} gov br`);
    queries.push(`${clean} site oficial`);
  } else {
    queries.push(`${clean} atual`);
    queries.push(`${clean} site oficial`);
  }

  return [...new Set(queries)].slice(0, MAX_QUERIES);
}

function shouldAttachRealtimeData(message) {
  const normalized = normalizeText(message);
  return [
    "dolar",
    "dólar",
    "euro",
    "bitcoin",
    "btc",
    "ethereum",
    "selic",
    "ipca",
    "cdi",
    "petroleo",
    "petróleo",
    "brent",
    "salario minimo",
    "salário mínimo",
    "irpf",
    "imposto de renda"
  ].some((term) => normalized.includes(normalizeText(term)));
}

async function fetchRealtimePrices() {
  const results = {};

  async function fetchJson(url) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REALTIME_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  const tasks = [
    (async () => {
      try {
        const data = await fetchJson("https://economia.awesomeapi.com.br/json/last/USD-BRL");
        const d = data?.USDBRL;
        if (!d) return;
        results.dollar = {
          value: parseFloat(d.bid).toFixed(4).replace(".", ","),
          high: parseFloat(d.high).toFixed(4).replace(".", ","),
          low: parseFloat(d.low).toFixed(4).replace(".", ","),
          variation: parseFloat(d.varBid).toFixed(4).replace(".", ","),
          pct: parseFloat(d.pctChange).toFixed(2).replace(".", ","),
          source: "AwesomeAPI",
          updatedAt: new Date(parseInt(d.timestamp, 10) * 1000).toLocaleString("pt-BR")
        };
      } catch {}

      if (!results.dollar) {
        try {
          const data = await fetchJson("https://api.bcb.gov.br/dados/serie/bcdata.sgs.10813/dados/ultimos/1?formato=json");
          if (data?.[0]?.valor) {
            results.dollar = {
              value: parseFloat(data[0].valor).toFixed(4).replace(".", ","),
              source: "Banco Central do Brasil (PTAX)",
              updatedAt: data[0].data
            };
          }
        } catch {}
      }
    })(),
    (async () => {
      try {
        const data = await fetchJson("https://economia.awesomeapi.com.br/json/last/EUR-BRL");
        const e = data?.EURBRL;
        if (!e) return;
        results.euro = {
          value: parseFloat(e.bid).toFixed(4).replace(".", ","),
          high: parseFloat(e.high).toFixed(4).replace(".", ","),
          low: parseFloat(e.low).toFixed(4).replace(".", ","),
          variation: parseFloat(e.varBid).toFixed(4).replace(".", ","),
          pct: parseFloat(e.pctChange).toFixed(2).replace(".", ","),
          source: "AwesomeAPI",
          updatedAt: new Date(parseInt(e.timestamp, 10) * 1000).toLocaleString("pt-BR")
        };
      } catch {}
    })(),
    (async () => {
      try {
        const data = await fetchJson("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json");
        if (data?.[0]?.valor) {
          results.selic = {
            value: `${parseFloat(data[0].valor).toFixed(2).replace(".", ",")}% a.a.`,
            source: "Banco Central SGS 432",
            updatedAt: data[0].data
          };
        }
      } catch {}
    })(),
    (async () => {
      try {
        const data = await fetchJson("https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1?formato=json");
        if (data?.[0]?.valor) {
          results.ipca = {
            value: `${parseFloat(data[0].valor).toFixed(2).replace(".", ",")}%`,
            source: "Banco Central SGS 433",
            updatedAt: data[0].data
          };
        }
      } catch {}
    })(),
    (async () => {
      try {
        const data = await fetchJson("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json");
        if (data?.[0]?.valor) {
          results.cdi = {
            value: `${parseFloat(data[0].valor).toFixed(4).replace(".", ",")}% ao dia`,
            source: "Banco Central SGS 12",
            updatedAt: data[0].data
          };
        }
      } catch {}
    })(),
    (async () => {
      try {
        if (!COMMODITIES_API_URL) return;
        const headers = COMMODITIES_API_KEY
          ? { "Authorization": `Bearer ${COMMODITIES_API_KEY}`, "X-API-KEY": COMMODITIES_API_KEY }
          : {};
        const data = await fetchJson(COMMODITIES_API_URL, { headers });
        const oilValue = data?.brent ?? data?.oil ?? data?.price ?? data?.value;
        const updatedAt = data?.updatedAt || data?.timestamp || data?.date || new Date().toISOString();
        if (!oilValue) return;
        results.oil = {
          value: String(oilValue),
          source: data?.source || "Commodities API",
          updatedAt: String(updatedAt)
        };
      } catch {}
    })(),
    (async () => {
      try {
        const data = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl%2Cusd&include_24hr_change=true");
        const btc = data?.bitcoin;
        if (!btc) return;
        results.bitcoin = {
          valueBrl: btc.brl.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
          valueUsd: btc.usd.toLocaleString("en-US", { minimumFractionDigits: 2 }),
          change24h: btc.brl_24h_change?.toFixed(2).replace(".", ",") || "",
          source: "CoinGecko",
          updatedAt: new Date().toLocaleString("pt-BR")
        };
      } catch {}
    })()
  ];

  await Promise.allSettled(tasks);
  return results;
}

function isRealtimePriceQuestion(message) {
  const normalized = normalizeText(message);
  return [
    "dolar",
    "dólar",
    "euro",
    "bitcoin",
    "btc",
    "ethereum",
    "ibovespa",
    "acao",
    "acoes",
    "petr4",
    "vale3",
    "selic",
    "ipca",
    "cdi",
    "petroleo",
    "petróleo",
    "brent"
  ].some((term) => normalized.includes(normalizeText(term)));
}

function findRelevantSnippet(text, query, size = 760) {
  const cleanText = stripHtml(text);
  const normalized = normalizeText(cleanText);
  const terms = normalizeText(query)
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !["site", "fonte", "oficial", "brasil"].includes(term));

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
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("xml")) {
      return "";
    }

    return findRelevantSnippet(await readResponseText(response), query);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichResultsWithPageSnippets(results, query) {
  const ranked = prioritizeResults(results);
  const officialResults = ranked
    .filter((result) => isLikelySafePage(result.url))
    .slice(0, MAX_PAGE_SNIPPETS);
  const fallbackResults = ranked
    .filter((result) => !officialResults.some((item) => item.url === result.url))
    .slice(0, Math.max(0, MAX_PAGE_SNIPPETS - officialResults.length));
  const targets = [...officialResults, ...fallbackResults].slice(0, MAX_PAGE_SNIPPETS);

  const snippets = await Promise.all(
    targets.map(async (result) => ({
      url: result.url,
      pageSnippet: await fetchPageSnippet(result.url, query)
    }))
  );

  const snippetByUrl = new Map(
    snippets.filter((item) => item.pageSnippet).map((item) => [item.url, item.pageSnippet])
  );

  return results.map((result) => ({
    ...result,
    source: result.source || getHostname(result.url),
    pageSnippet: snippetByUrl.get(result.url) || undefined
  }));
}

function makeBrowserHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1"
  };
}

function makeResult({ title, url, snippet, provider, source }) {
  return {
    title: stripHtml(title),
    url: cleanSearchUrl(url),
    snippet: stripHtml(snippet || ""),
    provider,
    source: source || getHostname(url)
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function buildSearchProviders(classification) {
  const providers = [];

  if (ENABLE_DDG_PROVIDER) {
    providers.push(["duckduckgo-html", async (query) => searchDuckDuckGoHtml(query)]);
    providers.push(["duckduckgo-lite", async (query) => searchDuckDuckGoLite(query)]);
  }

  if (ENABLE_SEARXNG_PROVIDER && SEARXNG_BASE_URL) {
    providers.push(["searxng", async (query) => {
      const endpoint = new URL("/search", SEARXNG_BASE_URL).toString();
      const data = await fetchJsonWithTimeout(
        `${endpoint}?q=${encodeURIComponent(query)}&format=json&language=pt-BR&safesearch=0&categories=general`,
        {
          headers: {
            "Accept": "application/json"
          }
        }
      );

      return prioritizeResults(
        (data?.results || []).map((item) =>
          makeResult({
            title: item.title,
            url: item.url,
            snippet: item.content || item.snippet,
            provider: "searxng",
            source: item.engine || item.url
          })
        )
      );
    }]);
  }

  if (ENABLE_PLAYWRIGHT_PROVIDER) {
    providers.push(["playwright", async (query) => searchWithPlaywright(query)]);
  }

  return providers;
}

async function searchDuckDuckGoHtml(query) {
  const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: makeBrowserHeaders(),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo retornou HTTP ${response.status}`);
  }

  const html = await readResponseText(response);
  const chunks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);

  return prioritizeResults(
    chunks
      .map((chunk) => {
        const linkMatch = chunk.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = chunk.match(/<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);

        if (!linkMatch) return null;

        return {
          title: stripHtml(linkMatch[2]),
          url: cleanSearchUrl(linkMatch[1]),
          snippet: stripHtml(snippetMatch?.[1] || ""),
          provider: "duckduckgo-html"
        };
      })
      .filter(Boolean)
      .slice(0, MAX_RESULTS * 2)
  );
}

async function searchDuckDuckGoLite(query) {
  const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: makeBrowserHeaders(),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo Lite retornou HTTP ${response.status}`);
  }

  const html = await readResponseText(response);
  const results = [];
  const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html))) {
    const title = stripHtml(match[2]);
    const url = cleanSearchUrl(match[1]);
    if (!title || !url.startsWith("http")) continue;
    results.push({
      title,
      url,
      snippet: "",
      provider: "duckduckgo-lite"
    });
    if (results.length >= MAX_RESULTS * 2) break;
  }

  return prioritizeResults(results);
}

async function searchBing(query) {
  const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    headers: makeBrowserHeaders(),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Bing retornou HTTP ${response.status}`);
  }

  const html = await readResponseText(response);
  const chunks = html.split(/<li[^>]+class="[^"]*b_algo[^"]*"[^>]*>/i).slice(1);

  return prioritizeResults(
    chunks
      .map((chunk) => {
        const linkMatch = chunk.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (!linkMatch) return null;
        return {
          title: stripHtml(linkMatch[2]),
          url: cleanSearchUrl(linkMatch[1]),
          snippet: stripHtml(snippetMatch?.[1] || ""),
          provider: "bing"
        };
      })
      .filter(Boolean)
      .slice(0, MAX_RESULTS * 2)
  );
}

async function searchGoogleNewsRss(query) {
  const response = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, {
    headers: makeBrowserHeaders(),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Google News RSS retornou HTTP ${response.status}`);
  }

  const xml = await readResponseText(response);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, MAX_RESULTS * 2);

  return prioritizeResults(
    items.map(([, item]) => ({
      title: decodeHtml((item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ""),
      url: decodeHtml((item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || ""),
      snippet: stripHtml((item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || item.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || ""),
      source: "news.google.com",
      provider: "google-news-rss"
    }))
  );
}

async function searchWithPlaywright(query) {
  if (typeof global.__VESTORA_PLAYWRIGHT_SEARCH__ === "function") {
    return prioritizeResults(await global.__VESTORA_PLAYWRIGHT_SEARCH__(query, { maxResults: MAX_RESULTS }));
  }

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

    await page.goto(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: PROVIDER_TIMEOUT_MS
    });

    const results = await page.$$eval(".result", (nodes, maxResults) =>
      nodes.slice(0, maxResults).map((node) => {
        const titleElement = node.querySelector(".result__a");
        const snippetElement = node.querySelector(".result__snippet");
        return {
          title: titleElement?.textContent?.trim() || "",
          url: titleElement?.getAttribute("href") || "",
          snippet: snippetElement?.textContent?.trim() || "",
          provider: "playwright-duckduckgo"
        };
      }),
      MAX_RESULTS
    );

    return prioritizeResults(results.map((result) => ({
      ...result,
      url: cleanSearchUrl(result.url)
    })));
  } finally {
    await browser.close().catch(() => {});
  }
}

function getCacheKey(message, classification) {
  return JSON.stringify({
    q: normalizeText(message),
    category: classification.category
  });
}

function getCachedSearch(cacheKey, ttlMs) {
  if (!ttlMs) return null;
  const cached = SEARCH_CACHE.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > ttlMs) {
    SEARCH_CACHE.delete(cacheKey);
    return null;
  }
  return {
    ...cached.value,
    fromCache: true
  };
}

function setCachedSearch(cacheKey, value) {
  SEARCH_CACHE.set(cacheKey, {
    createdAt: Date.now(),
    value
  });
}

async function runProvider(name, fn, query) {
  const startedAt = Date.now();
  try {
    const results = await fn(query);
    logSearch("info", "provider-success", {
      provider: name,
      query,
      durationMs: Date.now() - startedAt,
      results: results.length
    });
    return results;
  } catch (error) {
    logSearch("warn", "provider-failure", {
      provider: name,
      query,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
    throw error;
  }
}

async function executeSearch(message, classification) {
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;
  const queries = buildSearchQueries(message, classification);
  const errors = [];
  let bestResults = [];
  let engine = "unavailable";
  let chosenQuery = queries[0];
  const providers = buildSearchProviders(classification);

  if (providers.length === 0) {
    return {
      searched: true,
      engine: "unavailable",
      query: chosenQuery,
      checkedAt: new Date().toISOString(),
      classification,
      externalSuccess: false,
      usedWebSearch: false,
      usedRealtimeData: false,
      results: [],
      warning: "Nenhum provider gratuito de busca externa esta configurado no momento.",
      errors: ["search-provider-not-configured"]
    };
  }

  for (const query of queries) {
    if (Date.now() >= deadline) {
      errors.push("Tempo total de busca excedido");
      break;
    }

    for (const [providerName, provider] of providers) {
      if (Date.now() >= deadline) break;

      try {
        const results = await runProvider(providerName, provider, query);
        if (results.length > 0) {
          bestResults = results;
          engine = providerName;
          chosenQuery = query;
          break;
        }
      } catch (error) {
        errors.push(`${providerName}: ${error.message}`);
      }
    }

    if (bestResults.length > 0) break;
  }

  const enriched = bestResults.length > 0
    ? await enrichResultsWithPageSnippets(bestResults.slice(0, MAX_RESULTS), chosenQuery)
    : [];

  return {
    searched: true,
    engine,
    query: chosenQuery,
    checkedAt: new Date().toISOString(),
    classification,
    externalSuccess: enriched.length > 0,
    usedWebSearch: enriched.length > 0,
    usedRealtimeData: false,
    results: enriched.slice(0, MAX_RESULTS),
    warning: enriched.length === 0
      ? "Nao foi possivel obter resultados atualizados suficientes na consulta externa."
      : undefined,
    errors: errors.slice(0, 6)
  };
}

async function pesquisarInternet(message, options = {}) {
  const classification = options.classification || classifyFreshnessNeed(message);
  const force = options.force === true;

  if (!force && !classification.shouldSearch) {
    logSearch("info", "search-skipped", {
      reason: classification.reason,
      category: classification.category,
      preview: String(message || "").slice(0, 120)
    });

    return {
      searched: false,
      skipped: true,
      externalSuccess: false,
      usedWebSearch: false,
      usedRealtimeData: false,
      checkedAt: new Date().toISOString(),
      classification,
      results: []
    };
  }

  const cacheKey = getCacheKey(message, classification);
  const cached = getCachedSearch(cacheKey, WEB_SEARCH_CACHE_TTL_MS);
  if (cached) {
    logSearch("info", "cache-hit", {
      category: classification.category,
      query: String(message || "").slice(0, 120)
    });
    return cached;
  }

  if (IN_FLIGHT_SEARCHES.has(cacheKey)) {
    logSearch("info", "join-inflight", {
      category: classification.category,
      query: String(message || "").slice(0, 120)
    });
    return IN_FLIGHT_SEARCHES.get(cacheKey);
  }

  const startedAt = Date.now();
  const promise = executeSearch(message, classification)
    .then((result) => {
      const finalResult = {
        ...result,
        fromCache: false,
        latencyMs: Date.now() - startedAt
      };
      setCachedSearch(cacheKey, finalResult);
      logSearch("info", "search-finished", {
        category: classification.category,
        engine: finalResult.engine,
        results: finalResult.results.length,
        latencyMs: finalResult.latencyMs
      });
      return finalResult;
    })
    .catch((error) => {
      logSearch("error", "search-crashed", {
        category: classification.category,
        error: error.message
      });
      return {
        searched: true,
        engine: "multi",
        checkedAt: new Date().toISOString(),
        classification,
        externalSuccess: false,
        usedWebSearch: false,
        usedRealtimeData: false,
        results: [],
        warning: "Dados em tempo real indisponiveis para esta consulta.",
        errors: [error.message]
      };
    })
    .finally(() => {
      IN_FLIGHT_SEARCHES.delete(cacheKey);
    });

  IN_FLIGHT_SEARCHES.set(cacheKey, promise);
  return promise;
}

async function enrichWithRealtimeData(internetResults, message) {
  if (!internetResults || !internetResults.searched || !isRealtimePriceQuestion(message)) {
    return internetResults;
  }

  const prices = await fetchRealtimePrices();
  const normalized = normalizeText(message);
  const injectedResults = [];

  if ((normalized.includes("dolar") || normalized.includes("dólar")) && prices.dollar) {
    const d = prices.dollar;
    injectedResults.push({
      title: `Dolar comercial - R$ ${d.value}`,
      url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.10813/dados/ultimos/1?formato=json",
      source: d.source,
      snippet: `Dolar comercial: R$ ${d.value}${d.pct ? ` | Variacao: ${d.pct}%` : ""}${d.updatedAt ? ` | Atualizado: ${d.updatedAt}` : ""}`
    });
  }

  if (normalized.includes("euro") && prices.euro) {
    const e = prices.euro;
    injectedResults.push({
      title: `Euro - R$ ${e.value}`,
      url: "https://economia.awesomeapi.com.br/json/last/EUR-BRL",
      source: e.source,
      snippet: `Euro: R$ ${e.value}${e.pct ? ` | Variacao: ${e.pct}%` : ""}${e.updatedAt ? ` | Atualizado: ${e.updatedAt}` : ""}`
    });
  }

  if ((normalized.includes("bitcoin") || normalized.includes("btc")) && prices.bitcoin) {
    const b = prices.bitcoin;
    injectedResults.push({
      title: `Bitcoin (BTC) - R$ ${b.valueBrl}`,
      url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl%2Cusd&include_24hr_change=true",
      source: b.source,
      snippet: `Bitcoin: R$ ${b.valueBrl} | US$ ${b.valueUsd}${b.change24h ? ` | Variacao 24h: ${b.change24h}%` : ""}`
    });
  }

  if (normalized.includes("selic") && prices.selic) {
    injectedResults.push({
      title: `Selic meta - ${prices.selic.value}`,
      url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json",
      source: prices.selic.source,
      snippet: `Selic meta: ${prices.selic.value} | Fonte: ${prices.selic.source} | Consulta: ${prices.selic.updatedAt}`
    });
  }

  if ((normalized.includes("ipca") || normalized.includes("inflacao") || normalized.includes("inflação")) && prices.ipca) {
    injectedResults.push({
      title: `IPCA mais recente - ${prices.ipca.value}`,
      url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1?formato=json",
      source: prices.ipca.source,
      snippet: `IPCA mais recente: ${prices.ipca.value} | Fonte: ${prices.ipca.source} | Consulta: ${prices.ipca.updatedAt}`
    });
  }

  if (normalized.includes("cdi") && prices.cdi) {
    injectedResults.push({
      title: `CDI - ${prices.cdi.value}`,
      url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json",
      source: prices.cdi.source,
      snippet: `CDI mais recente: ${prices.cdi.value} | Fonte: ${prices.cdi.source} | Consulta: ${prices.cdi.updatedAt}`
    });
  }

  if ((normalized.includes("petroleo") || normalized.includes("petróleo") || normalized.includes("brent")) && prices.oil) {
    injectedResults.push({
      title: `Petroleo Brent - ${prices.oil.value}`,
      url: COMMODITIES_API_URL || "https://example.com/commodities",
      source: prices.oil.source,
      snippet: `Petroleo Brent: ${prices.oil.value} | Fonte: ${prices.oil.source} | Consulta: ${prices.oil.updatedAt}`
    });
  }

  if (injectedResults.length === 0) return internetResults;

  return {
    ...internetResults,
    engine: internetResults.engine === "unavailable" ? "realtime-api" : internetResults.engine,
    externalSuccess: true,
    usedWebSearch: Boolean(internetResults.usedWebSearch || (internetResults.results || []).length > 0),
    usedRealtimeData: true,
    warning: undefined,
    checkedAt: new Date().toISOString(),
    results: prioritizeResults([
      ...injectedResults,
      ...(internetResults.results || [])
    ])
  };
}

function clearSearchCaches() {
  SEARCH_CACHE.clear();
  IN_FLIGHT_SEARCHES.clear();
}

module.exports = {
  pesquisarInternet,
  shouldPesquisarInternet: shouldSearchForFreshness,
  classifyFreshnessNeed,
  isRealtimePriceQuestion,
  enrichWithRealtimeData,
  fetchRealtimePrices,
  clearSearchCaches,
  shouldAttachRealtimeData
};
