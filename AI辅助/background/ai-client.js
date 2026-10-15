(function (root) {
  const learnedParameters = new Map();
  const budget = root.CodingAiBudget;

  function failure(code, message, extras = {}) {
    return Object.assign(new Error(message), { code, ...extras });
  }

  function textContent(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(textContent).join("");
    if (!value || typeof value !== "object" || value.type === "reasoning") return "";
    return textContent(value.text ?? value.content ?? value.output_text ?? value.value);
  }

  function parseResult(data) {
    const choice = data && data.choices && data.choices[0];
    const message = choice && (choice.message || choice.delta);
    const answer = textContent(message && message.content || choice && choice.text || data && (data.output_text || data.output || data.content || data.text)).trim();
    if (choice && choice.finish_reason === "length" || data && data.status === "incomplete") {
      throw failure("OUTPUT_LIMIT", "模型达到输出长度上限，回答尚未完成。", { partialAnswer: answer });
    }
    if (choice && choice.finish_reason === "content_filter" || message && message.refusal) {
      throw failure("REFUSED", "模型未完成本次检查：" + (message && message.refusal || "接口限制了输出。"));
    }
    if (!answer) {
      const reasoning = message && textContent(message.reasoning_content || message.reasoning || message.thinking);
      throw failure(reasoning ? "REASONING_ONLY" : "EMPTY_RESPONSE", reasoning
        ? "模型只返回思考内容，没有最终答案。请在接口支持时调整推理设置，或提高最大输出长度。"
        : "接口没有返回有效正文，请检查模型和接口配置。");
    }
    return answer;
  }

  function checkCanceled(signal) {
    if (signal && signal.aborted) throw failure("CANCELED", "已停止生成。");
  }

  function delay(ms, signal) {
    checkCanceled(signal);
    return new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(failure("CANCELED", "已停止生成。")); };
      const timer = setTimeout(() => { signal && signal.removeEventListener("abort", onAbort); resolve(); }, ms);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function fetchResult(endpoint, body, options) {
    checkCanceled(options.signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const timer = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000);
    if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const headers = { "Content-Type": "application/json" };
      if (options.apiKey) headers.Authorization = "Bearer " + options.apiKey;
      const response = await (options.fetch || root.fetch)(endpoint, {
        method: "POST", headers, body: JSON.stringify(body), signal: controller.signal
      });
      const raw = await response.text(); // The deadline and cancellation cover the body too.
      checkCanceled(options.signal);
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      if (!response.ok) {
        const detail = String(data && data.error && data.error.message || data && data.message || raw || response.statusText).slice(0, 1500);
        const code = response.status === 401 || response.status === 403 ? "AUTH"
          : response.status === 429 ? "RATE_LIMIT"
          : response.status >= 500 ? "SERVER"
          : /context.{0,40}(?:length|window)|maximum context|上下文.{0,12}(?:超|长度)/i.test(detail) ? "CONTEXT_LIMIT" : "API_ERROR";
        const retryHeader = response.headers && response.headers.get("retry-after");
        const retryAfterMs = retryHeader
          ? (/^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) * 1000 : Math.max(0, Date.parse(retryHeader) - Date.now())) : 0;
        throw failure(code, "接口返回 HTTP " + response.status + "：" + detail, {
          status: response.status, param: data && data.error && data.error.param,
          apiCode: data && data.error && data.error.code, retryAfterMs
        });
      }
      if (!data || typeof data !== "object" || /<!doctype html|<html/i.test(raw.slice(0, 500))) {
        throw failure("RESPONSE_FORMAT", "接口没有返回有效的模型 JSON 响应，请检查 API 地址。");
      }
      return parseResult(data);
    } catch (error) {
      checkCanceled(options.signal);
      if (error.name === "AbortError") throw failure("TIMEOUT", "本次请求超过 " + options.timeoutSeconds + " 秒，尚未完成。");
      if (error.code) throw error;
      throw failure("NETWORK", "请求连接中断：" + (error.message || String(error)));
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    }
  }

  async function call(messages, options = {}) {
    const rawSettings = options.settings || {};
    const settings = budget.normalize(rawSettings);
    const endpoint = String(rawSettings.apiEndpoint || "").trim();
    const model = String(rawSettings.model || "").trim();
    if (!endpoint || !model) throw failure("CONFIG", "请先在插件设置中填写 AI API 地址和模型名称。");
    const key = endpoint + "\n" + model;
    const learned = learnedParameters.get(key) || {};
    let host;
    try {
      const url = new URL(endpoint);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
      host = url.hostname;
    } catch { throw failure("CONFIG", "AI API 地址无效，请填写完整的 HTTP 或 HTTPS 地址。"); }
    let field = settings.tokenParameter === "auto" ? learned.field || (host === "api.openai.com" ? "max_completion_tokens" : "max_tokens") : settings.tokenParameter;
    let temperature = settings.reasoningMode === "default" && !learned.omitTemperature && !/^(?:o\d|gpt-[5-9])/.test(model);
    let tokens = budget.outputTokens(options.taskType, messages, settings);
    const available = settings.contextWindowTokens - budget.messageTokens(messages) - 1024;
    if (available < 512) throw failure("CONTEXT_LIMIT", "题面和代码超过配置的上下文预算，请缩小检查段或调整上下文容量。");
    tokens = Math.min(tokens, available);
    const ceiling = Math.min(settings.maxOutputTokens, available);
    let grew = false;
    let transientRetries = 0;
    let fieldChanged = false;
    let lastError;
    const timeoutSeconds = Math.min(300, Math.max(1, Number(rawSettings.timeoutSeconds) || 90));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      checkCanceled(options.signal);
      const body = { model, messages, stream: false, [field]: tokens };
      if (temperature) body.temperature = 0.1;
      if (settings.reasoningMode === "low" || settings.reasoningMode === "none") body.reasoning_effort = settings.reasoningMode;
      if (settings.reasoningMode === "thinking-off") body.enable_thinking = false;
      try {
        const answer = await fetchResult(endpoint, body, { ...options, timeoutSeconds });
        learnedParameters.set(key, { field, omitTemperature: !temperature });
        return answer;
      } catch (error) {
        lastError = error;
        if (error.code === "CANCELED") throw error;
        if (error.code === "API_ERROR" && error.status === 400) {
          const unsupported = /unsupported|not supported|unrecognized|unknown|not allowed|不支持|未知/i.test(error.message);
          const invalidValue = /(?:unsupported|invalid)[_ ]value/i.test(String(error.apiCode || "") + " " + error.message);
          if (settings.tokenParameter === "auto" && !fieldChanged && unsupported && !invalidValue && (error.param === field || error.message.includes(field))) {
            field = field === "max_tokens" ? "max_completion_tokens" : "max_tokens";
            fieldChanged = true;
            continue;
          }
          if (temperature && unsupported && (error.param === "temperature" || error.message.includes("temperature"))) {
            temperature = false;
            continue;
          }
        }
        if ((error.code === "OUTPUT_LIMIT" || error.code === "REASONING_ONLY") && !grew && tokens < ceiling) {
          tokens = Math.min(ceiling, tokens * 2);
          grew = true;
          if (options.onProgress) options.onProgress("输出尚未完成，正在增加预算重试当前部分。");
          continue;
        }
        if (["RATE_LIMIT", "SERVER", "TIMEOUT", "NETWORK"].includes(error.code) && transientRetries < 1) {
          const wait = Math.max(1000, error.retryAfterMs || 0);
          if (wait > 10000) throw error;
          transientRetries += 1;
          if (options.onProgress) options.onProgress("当前请求暂未成功，正在重试当前部分。");
          await (options.delay || delay)(wait, options.signal);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  const api = { call, parseResult, fetchResult, failure };
  root.CodingAiClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
