const endpointInput = document.getElementById("api-endpoint");
const completeEndpointButton = document.getElementById("complete-endpoint-btn");
const modelInput = document.getElementById("model");
const timeoutInput = document.getElementById("timeout-seconds");
const maxOutputInput = document.getElementById("max-output-tokens");
const contextWindowInput = document.getElementById("context-window-tokens");
const tokenParameterSelect = document.getElementById("token-parameter");
const reasoningModeSelect = document.getElementById("reasoning-mode");
const keyInput = document.getElementById("api-key");
const problemSourceInput = document.getElementById("problem-source");
const problemServerInput = document.getElementById("problem-server-endpoint");
const problemServerTokenInput = document.getElementById("problem-server-token");
const problemServerSendPageTextInput = document.getElementById("problem-server-send-page-text");
const problemServerSendSelectionInput = document.getElementById("problem-server-send-selection");
const problemServerSendCodeInput = document.getElementById("problem-server-send-code");
const saveButton = document.getElementById("save-btn");
const testButton = document.getElementById("test-btn");
const testProblemServerButton = document.getElementById("test-problem-server-btn");
const statusText = document.getElementById("status");

chrome.storage.sync.get({
  apiEndpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  timeoutSeconds: 90,
  maxOutputTokens: 8192,
  contextWindowTokens: 32768,
  tokenParameter: "auto",
  reasoningMode: "default",
  problemSource: "auto",
  problemServerEndpoint: "",
  problemServerToken: "",
  problemServerSendPageText: true,
  problemServerSendSelection: false,
  problemServerSendCode: false
}, (settings) => {
  chrome.storage.local.get({ apiKey: "", problemServerToken: "" }, (secrets) => {
    endpointInput.value = settings.apiEndpoint;
  modelInput.value = settings.model;
  timeoutInput.value = String(settings.timeoutSeconds);
  maxOutputInput.value = String(settings.maxOutputTokens);
  contextWindowInput.value = String(settings.contextWindowTokens);
  tokenParameterSelect.value = settings.tokenParameter;
  reasoningModeSelect.value = settings.reasoningMode;
  keyInput.value = secrets.apiKey;
  problemSourceInput.value = settings.problemSource || "auto";
  problemServerInput.value = settings.problemServerEndpoint;
  problemServerTokenInput.value = secrets.problemServerToken;
  problemServerSendPageTextInput.checked = settings.problemServerSendPageText !== false;
  problemServerSendSelectionInput.checked = Boolean(settings.problemServerSendSelection);
  problemServerSendCodeInput.checked = Boolean(settings.problemServerSendCode);
  });
});

completeEndpointButton.addEventListener("click", () => {
  endpointInput.value = completeEndpoint(endpointInput.value);
  setStatus("已补全为 Chat Completions 地址，请保存配置。", false);
});

saveButton.addEventListener("click", () => {
  saveSettings(() => {
    setStatus("配置已保存。刷新学习网页后即可使用。", false);
  });
});

testButton.addEventListener("click", () => {
  saveSettings(() => {
    setStatus("正在测试 AI 连接...", false);
    testButton.disabled = true;

    chrome.runtime.sendMessage({ type: "TEST_CODING_AI" }, (response) => {
      testButton.disabled = false;

      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, true);
        return;
      }

      if (!response || !response.ok) {
        setStatus(response && response.error ? response.error : "AI 连接测试失败。", true);
        return;
      }

      setStatus("AI 连接成功。返回内容：" + response.answer, false);
    });
  });
});

testProblemServerButton.addEventListener("click", () => {
  saveSettings(() => {
      setStatus("正在测试题目来源...", false);
    testProblemServerButton.disabled = true;

    chrome.runtime.sendMessage({ type: "TEST_PROBLEM_SERVER" }, (response) => {
      testProblemServerButton.disabled = false;

      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, true);
        return;
      }

      if (!response || !response.ok) {
        setStatus(response && response.error ? response.error : "题目来源测试失败。", true);
        return;
      }

      setStatus((response.source || "题目来源") + "连接成功，已返回 " + String(response.problem || "").length + " 字。", false);
    });
  });
});

function saveSettings(callback) {
  chrome.storage.sync.set({
    apiEndpoint: endpointInput.value.trim(),
    model: modelInput.value.trim(),
    timeoutSeconds: normalizeTimeout(timeoutInput.value),
    maxOutputTokens: normalizeLimit(maxOutputInput.value, 8192, 512, 65536),
    contextWindowTokens: normalizeLimit(contextWindowInput.value, 32768, 4096, 2000000),
    tokenParameter: tokenParameterSelect.value,
    reasoningMode: reasoningModeSelect.value,
    problemSource: problemSourceInput.value,
    problemServerEndpoint: problemServerInput.value.trim(),
    problemServerSendPageText: problemServerSendPageTextInput.checked,
    problemServerSendSelection: problemServerSendSelectionInput.checked,
    problemServerSendCode: problemServerSendCodeInput.checked
  }, () => {
    if (chrome.runtime.lastError) {
      setStatus("配置保存失败：" + chrome.runtime.lastError.message, true);
      return;
    }
    chrome.storage.local.set({
      apiKey: keyInput.value.trim(),
      problemServerToken: problemServerTokenInput.value.trim()
    }, () => {
      if (chrome.runtime.lastError) {
        setStatus("密钥保存失败：" + chrome.runtime.lastError.message, true);
        return;
      }
      callback();
    });
  });
}

function completeEndpoint(value) {
  let endpoint = String(value || "").trim().replace(/\/+$/, "");

  if (!endpoint) {
    return "";
  }

  if (endpoint.endsWith("/v1")) {
    return endpoint + "/chat/completions";
  }

  if (endpoint.endsWith("/chat/completions") || endpoint.endsWith("/completions")) {
    return endpoint;
  }

  return endpoint + "/v1/chat/completions";
}

function normalizeTimeout(value) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds)) {
    return 90;
  }

  return Math.min(300, Math.max(30, Math.round(seconds)));
}

function normalizeLimit(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function setStatus(message, isError) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#b42318" : "#17633d";
}
