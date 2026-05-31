const SEARCH_TIMEOUT_MS = 9000;
const MAX_RESULTS = 5;
const PRIORITY_DOMAINS = [
  "gov.br",
  "bcb.gov.br",
  "caixa.gov.br",
  "b3.com.br",
  "cvm.gov.br",
  "fgc.org.br",
  "receita.economia.gov.br"
];

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(text) {
  return decodeHtml(String(text || "").replace(/<[^>]+>/g, " "));
}

function cleanDuckDuckGoUrl(rawUrl) {
  const value = decodeHtml(rawUrl);

  try {
    const url = new URL(value, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : url.href;
  } catch {
    return value;
  }
}

function shouldPesquisarInternet(message) {
  const normalized = normalizeText(message);
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
    "minha casa minha vida",
    "mcmv",
    "imovel",
    "imoveis"
  ];

  return currentTerms.some((term) => normalized.includes(term));
}

function buildSearchQueries(message) {
  const clean = String(message || "").replace(/\s+/g, " ").trim();
  const base = clean || "educacao financeira Brasil 2026";
  return [
    `${base} 2026 fonte oficial`,
    `${base} site:gov.br OR site:bcb.gov.br OR site:caixa.gov.br OR site:b3.com.br`
  ];
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
        url: cleanDuckDuckGoUrl(result.url)
      })));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function searchWithFetch(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo retornou HTTP ${response.status}`);
    }

    const html = await response.text();
    const chunks = html.split(/<div[^>]+class="[^"]*result[^"]*"[^>]*>/i).slice(1);

    return prioritizeResults(chunks
      .map((chunk) => {
        const linkMatch = chunk.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = chunk.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

        if (!linkMatch) return null;

        return {
          title: stripHtml(linkMatch[2]),
          url: cleanDuckDuckGoUrl(linkMatch[1]),
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
      const results = await searchWithPlaywright(query);
      if (results.length > 0) {
        return {
          searched: true,
          engine: "DuckDuckGo",
          query,
          checkedAt: new Date().toISOString(),
          results
        };
      }
    } catch (error) {
      errors.push(error.message);
    }

    try {
      const results = await searchWithFetch(query);
      if (results.length > 0) {
        return {
          searched: true,
          engine: "DuckDuckGo",
          query,
          checkedAt: new Date().toISOString(),
          results
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
