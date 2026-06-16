const endpointInput = document.getElementById("api-endpoint");
const completeEndpointButton = document.getElementById("complete-endpoint-btn");
const modelInput = document.getElementById("model");
const timeoutInput = document.getElementById("timeout-seconds");
const keyInput = document.getElementById("api-key");
const problemSourceInput = document.getElementById("problem-source");
const problemServerInput = document.getElementById("problem-server-endpoint");
const problemServerTokenInput = document.getElementById("problem-server-token");
const externalEditorButton = document.getElementById("external-editor-btn");
const saveButton = document.getElementById("save-btn");
const testButton = document.getElementById("test-btn");
const testProblemServerButton = document.getElementById("test-problem-server-btn");
const statusText = document.getElementById("status");

chrome.storage.sync.get({
  apiEndpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  timeoutSeconds: 90,
  problemSource: "auto",
  problemServerEndpoint: "",
  problemServerToken: ""
}, (settings) => {
  endpointInput.value = settings.apiEndpoint;
  modelInput.value = settings.model;
  timeoutInput.value = String(settings.timeoutSeconds);
  keyInput.value = settings.apiKey;
  problemSourceInput.value = settings.problemSource || "auto";
  problemServerInput.value = settings.problemServerEndpoint;
  problemServerTokenInput.value = settings.problemServerToken;
});

externalEditorButton.addEventListener("click", () => {
  externalEditorButton.disabled = true;
  setStatus("正在打开独立编辑窗口...", false);

  chrome.runtime.sendMessage({ type: "OPEN_EXTERNAL_EDITOR" }, (response) => {
    externalEditorButton.disabled = false;

    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }

    if (!response || !response.ok) {
      setStatus(response && response.error ? response.error : "独立编辑窗口打开失败。", true);
      return;
    }

    setStatus("独立编辑窗口已打开。", false);
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
    apiKey: keyInput.value.trim(),
    problemSource: problemSourceInput.value,
    problemServerEndpoint: problemServerInput.value.trim(),
    problemServerToken: problemServerTokenInput.value.trim()
  }, callback);
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

function setStatus(message, isError) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#b42318" : "#17633d";
}
