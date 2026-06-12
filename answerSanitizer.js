function stripTaggedReasoning(text) {
  return String(text || "")
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<reasoning\b[^>]*>[\s\S]*?(?:<\/reasoning>|$)/gi, "")
    .replace(/<\/?think\b[^>]*>/gi, "")
    .replace(/<\/?reasoning\b[^>]*>/gi, "");
}

function stripHtmlArtifacts(text) {
  return String(text || "")
    .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_, __, href, label) => {
      const cleanLabel = String(label || "").replace(/<[^>]+>/g, "").trim() || href;
      return `${cleanLabel} (${href})`;
    })
    .replace(/<\/?(?:div|span|p|a|strong|em|code|pre|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|br)[^>]*>/gi, "")
    .replace(/^\s*(?:target|rel|class|style|title)=["'][^"']*["']\s*$/gim, "")
    .replace(/\s+(?:target|rel|class|style|title)=["'][^"']*["']/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#039;/gi, "'");
}

function stripInternalEnglishMeta(text) {
  let output = String(text || "");

  const leadingPatterns = [
    /^(?:\s*(?:here(?:'|’)s|here is)\s+(?:my\s+)?(?:reasoning|analysis|thought process)[\s:.-]*)(?:\n+|$)/i,
    /^(?:\s*(?:internal\s+)?(?:reasoning|analysis|thinking)[\s:.-]*)(?:\n+|$)/i,
    /^(?:\s*let(?:'|’)s think step by step[\s:.-]*)(?:\n+|$)/i,
    /^(?:\s*i(?:'|’)ll think step by step[\s:.-]*)(?:\n+|$)/i,
    /^(?:\s*i will think step by step[\s:.-]*)(?:\n+|$)/i,
    /^(?:\s*i(?:'|’)m going to think[\s:.-]*)(?:\n+|$)/i,
    /^(?:\s*i am going to think[\s:.-]*)(?:\n+|$)/i,
    /^(?:\s*step[- ]by[- ]step reasoning[\s:.-]*)(?:\n+|$)/i
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadingPatterns) {
      if (pattern.test(output)) {
        output = output.replace(pattern, "");
        changed = true;
      }
    }
  }

  return output
    .replace(/^\s*(?:thought:|reasoning:|analysis:|thinking:)\s.*$/gim, "")
    .replace(/^\s*(?:first,?\s+let(?:'|’)s|let(?:'|’)s)\s+think.*$/gim, "")
    .replace(/^\s*i(?:'|’)ll\s+(?:think|reason)\s+.*$/gim, "")
    .replace(/^\s*i will\s+(?:think|reason)\s+.*$/gim, "");
}

function stripContradictoryLeadIn(text) {
  const input = String(text || "").trim();
  const patterns = [
    /^\s*(?:nao|não)\s+(?:sei|consigo|consegui)\b[^\n.!?]*(?:[.!?]+)?\s*/i,
    /^\s*(?:desculpe,?\s*)?(?:nao|não)\s+foi\s+possivel\s+[^\n.!?]*(?:[.!?]+)?\s*/i
  ];

  for (const pattern of patterns) {
    if (!pattern.test(input)) continue;
    const stripped = input.replace(pattern, "").trim();
    if (stripped && /[a-zà-ÿ0-9]/i.test(stripped)) {
      return stripped;
    }
  }

  return input;
}

const FRIENDLY_DATA_FALLBACK = "Não consegui obter dados atualizados neste momento. Tente novamente em alguns minutos.";

function stripTechnicalLeakLines(text) {
  const technicalPatterns = [
    /\bHTTP\s*\d{3}\b/i,
    /\b(?:status\s+code|statusCode)\s*\d{3}\b/i,
    /\b(?:stack\s*trace|traceback|exception|typeerror|referenceerror|syntaxerror|timeouterror|aborterror|failed\s+to\s+fetch|request\s+failed)\b/i,
    /^\s*at\s+[\w.<anonymous>/$-]+(?:\s|\()/i,
    /\b(?:internetSearch|server\.js|groq\.js|playwright|chromium|browser|page\.goto|fetchSource)\b/i,
    /\b(?:falhas?\s+de\s+navegador|erro(?:s)?\s+de\s+navegador|navegador\s+falhou)\b/i,
    /\b(?:erro(?:s)?\s+t[eé]cnico(?:s)?|falha(?:s)?\s+t[eé]cnica(?:s)?|demais\s+fontes\s+retornaram)\b/i,
    /\b(?:mensagem|instru[cç][aã]o|prompt|log)\s+intern[ao]\b/i,
    /\b(?:provider|source|upstream|endpoint|api)\s+(?:unavailable|failed|error|timeout)\b/i,
    /n[aã]o\s+foi\s+poss[ií]vel\s+responder\s+com\s+seguran[cç]a\s+agora/i
  ];

  const lines = String(text || "").split("\n");
  const cleaned = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      cleaned.push(line);
      continue;
    }

    if (technicalPatterns.some((pattern) => pattern.test(trimmed))) {
      continue;
    }

    cleaned.push(line);
  }

  return cleaned.join("\n");
}

function normalizeAnswerSpacing(text) {
  return String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function sanitizeModelAnswer(text) {
  const cleaned = normalizeAnswerSpacing(
    stripContradictoryLeadIn(
      stripTechnicalLeakLines(
        stripInternalEnglishMeta(
          stripHtmlArtifacts(
            stripTaggedReasoning(text)
          )
        )
      )
    )
  );

  return cleaned || FRIENDLY_DATA_FALLBACK;
}

module.exports = {
  FRIENDLY_DATA_FALLBACK,
  sanitizeModelAnswer
};
