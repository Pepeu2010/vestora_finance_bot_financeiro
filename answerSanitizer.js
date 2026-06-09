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

function normalizeAnswerSpacing(text) {
  return String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function sanitizeModelAnswer(text) {
  return normalizeAnswerSpacing(
    stripContradictoryLeadIn(
      stripInternalEnglishMeta(
        stripHtmlArtifacts(
          stripTaggedReasoning(text)
        )
      )
    )
  );
}

module.exports = {
  sanitizeModelAnswer
};
