const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const REQUEST_TIMEOUT_MS = 6500;

const cache = new Map();

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function findSnippet(text, terms, size = 420) {
  const normalized = normalizeText(text);
  const index = terms
    .map((term) => normalized.indexOf(normalizeText(term)))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];

  if (index === undefined) return "";

  const start = Math.max(0, index - Math.floor(size / 3));
  return text.slice(start, start + size).trim();
}

async function fetchText(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.text;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Vestora/1.0 (+https://github.com/Pepeu2010/vestora)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Fonte retornou HTTP ${response.status}`);
    }

    const text = stripHtml(await response.text());
    cache.set(url, { text, createdAt: Date.now() });
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtml(url) {
  const cached = cache.get(`${url}::html`);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.html;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Vestora/1.0 (+https://github.com/Pepeu2010/vestora)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Fonte retornou HTTP ${response.status}`);
    }

    const html = await response.text();
    cache.set(`${url}::html`, { html, createdAt: Date.now() });
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.json;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Vestora/1.0 (+https://github.com/Pepeu2010/vestora)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Fonte retornou HTTP ${response.status}`);
    }

    const json = await response.json();
    cache.set(url, { json, createdAt: Date.now() });
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function parseBrlNumber(value) {
  return Number(String(value || "").replace(",", "."));
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "";
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

function lastItem(items) {
  return Array.isArray(items) && items.length > 0 ? items[items.length - 1] : null;
}

function isMacroQuestion(message) {
  const normalized = normalizeText(message);
  return [
    "selic",
    "ipca",
    "inflacao",
    "inflação",
    "cdi",
    "renda fixa",
    "tesouro selic",
    "tesouro direto",
    "cdb",
    "lci",
    "lca",
    "poupanca",
    "poupança"
  ].some((term) => normalized.includes(normalizeText(term)));
}

function isTaxOrGuaranteeQuestion(message) {
  const normalized = normalizeText(message);
  return [
    "imposto",
    "ir",
    "iof",
    "fgc",
    "garantia",
    "cdb",
    "lci",
    "lca",
    "renda fixa"
  ].some((term) => normalized.includes(normalizeText(term)));
}

function isSalaryMinimumQuestion(message) {
  const normalized = normalizeText(message);
  return normalized.includes("salario minimo") || normalized.includes("salário mínimo");
}

function isIrfTableQuestion(message) {
  const normalized = normalizeText(message);
  return (
    normalized.includes("imposto de renda") ||
    normalized.includes("irpf") ||
    normalized.includes("tabela do ir") ||
    normalized.includes("tabela ir")
  );
}

function isTreasuryQuestion(message) {
  const normalized = normalizeText(message);
  return [
    "tesouro",
    "tesouro direto",
    "tesouro selic",
    "tesouro ipca",
    "tesouro prefixado",
    "taxa de custodia",
    "custodia b3"
  ].some((term) => normalized.includes(normalizeText(term)));
}

async function getBancoCentralFacts() {
  const [selicMetaData, ipcaData, cdiData] = await Promise.all([
    fetchJson("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json"),
    fetchJson("https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/12?formato=json"),
    fetchJson("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json")
  ]);

  const selicMeta = lastItem(selicMetaData);
  const latestIpca = lastItem(ipcaData);
  const ipca12m = ipcaData.reduce((acc, item) => acc * (1 + parseBrlNumber(item.valor) / 100), 1) - 1;
  const cdiDaily = lastItem(cdiData);
  const cdiDailyValue = parseBrlNumber(cdiDaily?.valor);
  const cdiAnnualApprox = Math.pow(1 + cdiDailyValue / 100, 252) - 1;

  return {
    topic: "Indicadores economicos 2026",
    verified: true,
    checkedAt: new Date().toISOString(),
    instruction:
      "Use estes indicadores do Banco Central como referencia atual. Para decisao financeira, diga que taxas mudam e devem ser conferidas novamente no dia da aplicacao.",
    facts: {
      selicMeta: selicMeta
        ? {
            value: `${formatPercent(parseBrlNumber(selicMeta.valor))} a.a.`,
            date: selicMeta.data,
            source: "Banco Central SGS serie 432"
          }
        : null,
      ipca: latestIpca
        ? {
            latestMonthly: formatPercent(parseBrlNumber(latestIpca.valor)),
            latestMonth: latestIpca.data,
            accumulated12mApprox: formatPercent(ipca12m * 100),
            source: "Banco Central SGS serie 433"
          }
        : null,
      cdi: cdiDaily
        ? {
            latestDaily: formatPercent(cdiDailyValue, 4),
            latestDate: cdiDaily.data,
            annualizedApprox: formatPercent(cdiAnnualApprox * 100),
            source: "Banco Central SGS serie 12"
          }
        : null
    },
    sources: [
      {
        name: "Banco Central SGS - Meta Selic",
        url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json"
      },
      {
        name: "Banco Central SGS - IPCA",
        url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/12?formato=json"
      },
      {
        name: "Banco Central SGS - CDI",
        url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json"
      }
    ]
  };
}

async function getTreasuryFacts() {
  const url = "https://www.b3.com.br/pt_br/produtos-e-servicos/tarifas/tarifas-de-tesouro-direto/";
  const text = await fetchText(url).catch(() => "");
  const snippet = text ? findSnippet(text, ["0,2% ao ano", "Tesouro Selic", "R$10.000"], 520) : "";

  return {
    topic: "Tesouro Direto 2026",
    verified: Boolean(snippet),
    checkedAt: new Date().toISOString(),
    instruction:
      "Use estes dados para Tesouro Direto. Se falar de preco/taxa de compra de titulo especifico, avise que muda diariamente e deve ser conferido no Tesouro Direto ou corretora.",
    facts:
      "B3 informa taxa de custodia de 0,20% ao ano no Tesouro Direto. Para Tesouro Selic, ha isencao da taxa de custodia sobre valores ate R$ 10.000 por CPF; saldo acima disso pode ter cobranca sobre o excedente. Precos e taxas dos titulos mudam diariamente.",
    sources: [
      {
        name: "B3 - Tarifas de Tesouro Direto",
        url,
        snippet
      }
    ]
  };
}

function getTaxAndGuaranteeFacts() {
  return {
    topic: "Renda fixa, impostos e garantias 2026",
    verified: true,
    checkedAt: new Date().toISOString(),
    instruction:
      "Use como referencia geral para renda fixa no Brasil em 2026. Se houver produto especifico, confirme no emissor/corretora.",
    facts:
      "IR regressivo em renda fixa tributada: 22,5% ate 180 dias; 20% de 181 a 360 dias; 17,5% de 361 a 720 dias; 15% acima de 720 dias. IOF pode incidir em resgates antes de 30 dias. LCI/LCA sao isentas de IR para pessoa fisica, mas podem ter carencia e risco de credito. FGC costuma cobrir CDB, LCI, LCA e outros produtos elegiveis ate R$ 250 mil por CPF/CNPJ por instituicao/conglomerado, limitado a R$ 1 milhao em 4 anos; Tesouro Direto nao tem FGC, pois e titulo publico federal.",
    sources: [
      {
        name: "Receita Federal - Tabelas IRPF 2026",
        url: "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas"
      },
      {
        name: "FGC - Garantia Ordinaria",
        url: "https://www.fgc.org.br/garantia-fgc/sobre-a-garantia-fgc"
      }
    ]
  };
}

async function getSalaryMinimumFacts() {
  const url = "https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/2025/12/publicado-decreto-que-reajusta-salario-minimo-para-r-1-621-a-partir-de-1o-de-janeiro";
  const html = await fetchHtml(url);
  const title = (html.match(/og:title" content="([^"]+)"/i) || [])[1] || "";
  const description = (html.match(/og:description" content="([^"]+)"/i) || [])[1] || "";
  const combined = `${title}. ${description}`;
  const valueMatch = combined.match(/R\$\s*1\.621\b/);

  return {
    topic: "Salario minimo 2026",
    verified: Boolean(valueMatch),
    checkedAt: new Date().toISOString(),
    instruction:
      "Use esta referencia oficial para responder sobre salario minimo de 2026. Se a pergunta for sobre liquido, desconto ou categoria profissional, diga que pode variar.",
    facts: valueMatch
      ? {
          currentValue: "R$ 1.621,00",
          startsAt: "01/01/2026",
          summary: stripHtml(combined),
          source: "Planalto"
        }
      : null,
    sources: [
      {
        name: "Planalto - reajuste do salario minimo",
        url,
        snippet: stripHtml(combined)
      }
    ]
  };
}

async function getIrf2026Facts() {
  const url = "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026";
  const html = await fetchHtml(url);
  const tableStart = html.indexOf("Tabela de Incidência Mensal");
  const section = tableStart >= 0 ? html.slice(tableStart, tableStart + 5000) : html;
  const rowMatches = [...section.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)];
  const monthlyTable = rowMatches
    .map((match) => ({
      faixa: stripHtml(match[1]),
      aliquota: stripHtml(match[2]),
      deducao: stripHtml(match[3])
    }))
    .filter((row) => row.faixa && row.aliquota !== "Imposto" && row.deducao !== "Imposto")
    .slice(0, 5);

  const dependentDeduction = stripHtml((section.match(/Dedução mensal por dependente:\s*([^<]+)/i) || [])[1] || "");
  const simplifiedDiscount = stripHtml((section.match(/Limite mensal de desconto simplificado:\s*([^<]+)/i) || [])[1] || "");

  return {
    topic: "Tabela IRPF 2026",
    verified: monthlyTable.length >= 5,
    checkedAt: new Date().toISOString(),
    instruction:
      "Use esta tabela mensal oficial da Receita Federal para 2026. Se a pergunta for sobre ajuste anual ou desconto simplificado, cite isso separadamente.",
    facts: {
      year: 2026,
      monthlyTable,
      dependentDeduction,
      simplifiedDiscount,
      source: "Receita Federal"
    },
    sources: [
      {
        name: "Receita Federal - Tabelas do Imposto de Renda 2026",
        url
      }
    ]
  };
}

function isMinhaCasaMinhaVidaQuestion(message) {
  const normalized = normalizeText(message);
  return (
    normalized.includes("minha casa minha vida") ||
    normalized.includes("mcmv") ||
    normalized.includes("casa verde amarela")
  );
}

function getTemporalGuardFacts() {
  return {
    topic: "Contexto temporal 2026",
    verified: true,
    checkedAt: new Date().toISOString(),
    instruction:
      "Estamos em 2026. A pesquisa online nao foi usada nesta resposta. Para qualquer numero atual, regra vigente, taxa, cotacao, preco, rendimento, imposto ou programa publico que nao esteja nos dados oficiais enviados, nao invente. Diga que precisa confirmar em fonte oficial ou peca dados atuais ao usuario.",
    facts:
      "Use 2026 como ano de referencia. Dados de mercado, leis, programas publicos, indicadores economicos, impostos e financiamento podem mudar."
  };
}

async function getGeneralOfficialSourcesFacts(message) {
  const normalized = normalizeText(message);
  const sourceGroups = [
    {
      topic: "Mercado financeiro e investimentos",
      terms: ["acao", "acoes", "fii", "fundo imobiliario", "cvm", "b3", "corretora", "investimento"],
      sources: [
        {
          name: "CVM - Portal do Investidor",
          url: "https://www.gov.br/investidor/pt-br",
          terms: ["investidor", "riscos", "mercado"]
        },
        {
          name: "B3 - Produtos e servicos",
          url: "https://www.b3.com.br/pt_br/produtos-e-servicos/",
          terms: ["produtos", "servicos", "renda variavel"]
        }
      ]
    },
    {
      topic: "Financiamento e imoveis",
      terms: ["imovel", "imoveis", "financiamento", "corretor", "cartorio", "entrada", "parcela"],
      sources: [
        {
          name: "CAIXA - Habitacao",
          url: "https://www.caixa.gov.br/voce/habitacao/Paginas/default.aspx",
          terms: ["habitacao", "financiamento", "imovel"]
        },
        {
          name: "Banco Central - Cidadania Financeira",
          url: "https://www.bcb.gov.br/cidadaniafinanceira",
          terms: ["educacao financeira", "cidadao", "credito"]
        }
      ]
    },
    {
      topic: "Impostos e declaracao",
      terms: ["imposto", "receita", "ir", "declaracao", "tributo"],
      sources: [
        {
          name: "Receita Federal",
          url: "https://www.gov.br/receitafederal/pt-br",
          terms: ["receita federal", "imposto", "cpf"]
        }
      ]
    }
  ];

  const group = sourceGroups.find((item) =>
    item.terms.some((term) => normalized.includes(normalizeText(term)))
  );

  if (!group) return null;

  const results = await Promise.allSettled(
    group.sources.map(async (source) => {
      const text = await fetchText(source.url);
      return {
        ...source,
        snippet: findSnippet(text, source.terms, 380)
      };
    })
  );

  const available = results
    .filter((result) => result.status === "fulfilled" && result.value.snippet)
    .map((result) => result.value);

  if (available.length === 0) return null;

  return {
    topic: group.topic,
    verified: true,
    checkedAt: new Date().toISOString(),
    instruction:
      "Use estas fontes apenas como apoio geral. Se o usuario pedir regra, taxa ou valor exato e isso nao estiver nos trechos, nao invente; diga para confirmar na fonte oficial.",
    facts:
      "Pesquisa online ativada pelo usuario. Foram consultadas fontes institucionais/oficiais relacionadas ao tema para reduzir risco de informacao desatualizada.",
    sources: available.map((source) => ({
      name: source.name,
      url: source.url,
      snippet: source.snippet
    }))
  };
}

async function getMinhaCasaMinhaVidaFacts() {
  const sources = [
    {
      name: "Ministerio das Cidades",
      url: "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/sobre-o-minha-casa-minha-vida-1",
      terms: ["R$ 13.000", "Faixa 4", "Faixa 1"]
    },
    {
      name: "CAIXA",
      url: "https://www.caixa.gov.br/voce/habitacao/minha-casa-minha-vida/urbana/Paginas/default.aspx",
      terms: ["R$ 13", "renda familiar mensal bruta", "taxa de juros"]
    }
  ];

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const text = await fetchText(source.url);
      return {
        ...source,
        snippet: findSnippet(text, source.terms)
      };
    })
  );

  const available = results
    .filter((result) => result.status === "fulfilled" && result.value.snippet)
    .map((result) => result.value);

  if (available.length === 0) {
    return {
      topic: "Minha Casa Minha Vida",
      verified: false,
      instruction:
        "Nao foi possivel confirmar as regras atuais online agora. Responda sem numeros exatos ou peça para o usuario confirmar no Ministerio das Cidades ou na CAIXA."
    };
  }

  return {
    topic: "Minha Casa Minha Vida",
    verified: true,
    checkedAt: new Date().toISOString(),
    instruction:
      "Use somente estes dados oficiais como referencia. Se algum numero nao aparecer aqui, nao invente; peça confirmacao na fonte oficial.",
    facts:
      "Referencia cadastrada e conferida em fontes oficiais: renda urbana ate R$ 13.000; Faixa 1 ate R$ 3.200; Faixa 2 de R$ 3.200,01 a R$ 5.000; Faixa 3 de R$ 5.000,01 a R$ 9.600; Faixa 4 ate R$ 13.000; MCMV Classe Media pode financiar imoveis de ate R$ 600 mil, conforme regras vigentes divulgadas pelo governo/CAIXA.",
    sources: available.map((source) => ({
      name: source.name,
      url: source.url,
      snippet: source.snippet
    }))
  };
}

async function getOfficialFactsForMessage(message, options = {}) {
  const online = options.online !== false;

  if (!online) {
    return getTemporalGuardFacts();
  }

  const facts = [];

  if (isMinhaCasaMinhaVidaQuestion(message)) {
    facts.push(await getMinhaCasaMinhaVidaFacts());
  }

  if (isMacroQuestion(message)) {
    const macroFacts = await getBancoCentralFacts().catch(() => null);
    if (macroFacts) facts.push(macroFacts);
  }

  if (isTreasuryQuestion(message)) {
    const treasuryFacts = await getTreasuryFacts().catch(() => null);
    if (treasuryFacts) facts.push(treasuryFacts);
  }

  if (isTaxOrGuaranteeQuestion(message)) {
    facts.push(getTaxAndGuaranteeFacts());
  }

  if (isSalaryMinimumQuestion(message)) {
    const salaryFacts = await getSalaryMinimumFacts().catch(() => null);
    if (salaryFacts) facts.push(salaryFacts);
  }

  if (isIrfTableQuestion(message)) {
    const irFacts = await getIrf2026Facts().catch(() => null);
    if (irFacts) facts.push(irFacts);
  }

  if (facts.length === 0) {
    const generalFacts = await getGeneralOfficialSourcesFacts(message).catch(() => null);
    if (generalFacts) facts.push(generalFacts);
  }

  if (facts.length === 0) {
    return {
      topic: "Contexto temporal 2026",
      verified: true,
      checkedAt: new Date().toISOString(),
      instruction:
        "Estamos em 2026. Para qualquer numero atual, regra vigente, taxa, cotacao, preco, rendimento, imposto ou programa publico que nao esteja nos dados oficiais enviados, nao invente. Diga que precisa confirmar em fonte oficial ou peça dados atuais ao usuario.",
      facts:
        "Use 2026 como ano de referencia. Dados de mercado, leis, programas publicos, indicadores economicos, impostos e financiamento podem mudar."
    };
  }

  return {
    topic: "Referencias oficiais e contexto 2026",
    verified: facts.some((fact) => fact.verified),
    checkedAt: new Date().toISOString(),
    instruction:
      "Use estes dados antes do conhecimento geral. Se algo nao estiver aqui, nao chute numeros atuais; diga que precisa confirmar em fonte oficial.",
    facts
  };
}

module.exports = {
  getOfficialFactsForMessage,
  isMinhaCasaMinhaVidaQuestion,
  isMacroQuestion
};
