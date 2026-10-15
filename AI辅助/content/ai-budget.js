(function (root) {
  function number(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
  }

  function normalize(settings = {}) {
    return {
      maxOutputTokens: number(settings.maxOutputTokens, 8192, 512, 65536),
      contextWindowTokens: number(settings.contextWindowTokens, 32768, 4096, 2000000),
      tokenParameter: ["auto", "max_tokens", "max_completion_tokens"].includes(settings.tokenParameter) ? settings.tokenParameter : "auto",
      reasoningMode: ["default", "low", "none", "thinking-off"].includes(settings.reasoningMode) ? settings.reasoningMode : "default"
    };
  }

  // Conservative estimate for planning, not a model-specific tokenizer.
  function estimateTokens(value) {
    const text = String(value || "");
    const nonAscii = (text.match(/[^\x00-\x7f]/g) || []).length;
    return Math.ceil((text.length - nonAscii) / 3 + nonAscii * 1.5);
  }

  function messageTokens(messages) {
    return 32 + messages.reduce((sum, message) => sum + estimateTokens(message.content) + 12, 0);
  }

  function outputTokens(task, messages, settings) {
    const limit = normalize(settings).maxOutputTokens;
    const wanted = task === "test" ? 256
      : task === "check" || task === "check-global" ? (messageTokens(messages) > 7000 ? 8192 : 4096)
      : task === "explain-selection" ? 3200 : 2400;
    return Math.min(limit, wanted);
  }

  const api = { normalize, estimateTokens, messageTokens, outputTokens };
  root.CodingAiBudget = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
