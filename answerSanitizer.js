function stripTaggedReasoning(text) {
  return String(text || "")
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<reasoning\b[^>]*>[\s\S]*?(?:<\/reasoning>|$)/gi, "")
    .replace(/<\/?think\b[^>]*>/gi, "")
    .replace(/<\/?reasoning\b[^>]*>/gi, "");
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

function normalizeAnswerSpacing(text) {
  return String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function sanitizeModelAnswer(text) {
  return normalizeAnswerSpacing(stripInternalEnglishMeta(stripTaggedReasoning(text)));
}

module.exports = {
  sanitizeModelAnswer
};
