const sourceTabId = Number(new URLSearchParams(location.search).get("tabId"));
const DRAFT_VERSION = 17;
const SCOPE_CONFIG = {
  small: {
    label: "只补光标处一小段",
    instruction: "只补光标附近接下来要写的一小段代码，不要扩展到当前局部逻辑之外。",
    before: 5,
    after: 5
  },
  block: {
    label: "只补当前代码块",
    instruction: "建议代码只能落在光标所在的当前代码块内，不要改写其他代码块。",
    before: 9,
    after: 9
  },
  function: {
    label: "只补当前函数",
    instruction: "建议代码只能服务于光标所在的当前函数或方法，不要重写整个类或其他函数。",
    before: 14,
    after: 14
  }
};

const sourceTitle = document.getElementById("source-title");
const syncButton = document.getElementById("sync-btn");
const insertPageButton = document.getElementById("insert-page-btn");
const languageSelect = document.getElementById("language");
const suggestionScopeSelect = document.getElementById("suggestion-scope");
const nextButton = document.getElementById("next-btn");
const checkButton = document.getElementById("check-btn");
const explainButton = document.getElementById("explain-btn");
const insertSuggestionButton = document.getElementById("insert-suggestion-btn");
const formatButton = document.getElementById("format-btn");
const stopButton = document.getElementById("stop-btn");
const problemStatus = document.getElementById("problem-status");
const problemInput = document.getElementById("problem");
const cursorStatus = document.getElementById("cursor-status");
const lineNumbers = document.getElementById("line-numbers");
const codeInput = document.getElementById("code");
const saveStatus = document.getElementById("save-status");
const output = document.getElementById("output");

let sourceTab = { id: sourceTabId, title: "", url: "" };
let lastProblemContext = "";
let lastServerSource = "Page Content";
let lastSuggestion = "";
let activeAiRequest = null;
let aiRequestSequence = 0;
let saveTimer = 0;
let sharedDraftKey = "";
let loadedDraftHistory = [];
let loadedLeetCodeTemplateCode = "";
let loadedLeetCodeTemplateUrl = "";
let loadedLeetCodeTemplateLanguage = "";
let isApplyingRemoteDraft = false;
let isSavingDraft = false;

init();

async function init() {
  bindEvents();
  updateSourceTitle();
  updateEditorMetrics();
  updateActionStates();

  if (!sourceTabId) {
    setProblemStatus("缺少源标签页");
    output.textContent = "独立编辑窗口没有拿到源标签页。请从题目页面、插件弹窗或右键菜单重新打开。";
    return;
  }

  await syncPageContext({ reason: "initial" });
  bindStorageSync();
}

function bindEvents() {
  syncButton.addEventListener("click", () => syncPageContext({ reason: "manual" }));
  insertPageButton.addEventListener("click", insertCodeIntoSourcePage);
  nextButton.addEventListener("click", () => runAI("next"));
  checkButton.addEventListener("click", () => runAI("check"));
  explainButton.addEventListener("click", () => runAI("explain-selection"));
  insertSuggestionButton.addEventListener("click", insertSuggestionAtCursor);
  formatButton.addEventListener("click", formatCodeInEditor);
  stopButton.addEventListener("click", cancelActiveAiRequest);

  problemInput.addEventListener("input", scheduleSaveDraft);
  languageSelect.addEventListener("change", scheduleSaveDraft);
  suggestionScopeSelect.addEventListener("change", scheduleSaveDraft);

  codeInput.addEventListener("input", () => {
    lastSuggestion = "";
    updateEditorMetrics();
    updateActionStates();
    scheduleSaveDraft();
  });
  codeInput.addEventListener("keyup", updateEditorMetrics);
  codeInput.addEventListener("click", updateEditorMetrics);
  codeInput.addEventListener("select", updateActionStates);
  codeInput.addEventListener("scroll", syncCodeScroll);
  codeInput.addEventListener("keydown", handleCodeKeydown);

  window.addEventListener("beforeunload", () => {
    clearTimeout(saveTimer);
    saveDraft();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "FLUSH_EXTERNAL_EDITOR_DRAFT") {
      return false;
    }

    if (Number(message.tabId) !== sourceTabId) {
      return false;
    }

    clearTimeout(saveTimer);
    saveDraft()
      .then((draft) => {
        sendResponse({
          ok: true,
          draftKey: getDraftKey(),
          savedAt: draft && draft.savedAt
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  });
}

function bindStorageSync() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || isSavingDraft) {
      return;
    }

    const change = changes[getDraftKey()];

    if (!change || !change.newValue) {
      return;
    }

    applyDraft(change.newValue);
    updateEditorMetrics();
    updateActionStates();
    saveStatus.textContent = "草稿已同步";
  });
}

async function syncPageContext(options = {}) {
  syncButton.disabled = true;
  setProblemStatus("正在同步");

  try {
    if (options.reason === "manual") {
      clearTimeout(saveTimer);
      await saveDraft();
    }

    const contextResponse = await sendRuntimeMessage({
      type: "GET_EXTERNAL_EDITOR_PAGE_CONTEXT",
      tabId: sourceTabId
    });

    sourceTab = contextResponse.tab || sourceTab;
    sharedDraftKey = contextResponse.draftKey || sharedDraftKey || buildDraftKeyFromUrl(sourceTab.url);
    updateSourceTitle();

    await loadDraft(contextResponse.draft);

    if (contextResponse.language && languageSelect.value === "auto") {
      languageSelect.value = contextResponse.language;
    }

    if (!codeInput.value.trim() && contextResponse.draftCode) {
      codeInput.value = contextResponse.draftCode;
      updateEditorMetrics();
    }

    if (options.reason === "initial" && problemInput.value.trim()) {
      setProblemStatus((lastServerSource || "草稿") + " · " + problemInput.value.length + " 字");
      updateActionStates();
      return;
    }

    const payload = {
      ...(contextResponse.payload || {}),
      code: codeInput.value,
      language: languageSelect.value || contextResponse.language || "auto"
    };

    const problemResponse = await sendRuntimeMessage({
      type: "FETCH_PROBLEM_CONTEXT",
      payload
    });
    const problem = window.CodingAssistantCore.normalizeProblemPayload(problemResponse.problem || problemResponse.data);

    lastProblemContext = problem || contextResponse.localProblem || "";
    lastServerSource = problemResponse.source || (problemResponse.fromServer ? "Server" : "Page Content");
    problemInput.value = lastProblemContext;
    setProblemStatus(lastServerSource + " · " + lastProblemContext.length + " 字");

    if (contextResponse.warning) {
      output.textContent = "题目已同步，但源页面内容脚本暂时不可达：" + contextResponse.warning;
    } else if (options.reason === "manual") {
      output.textContent = "题目上下文已同步。";
    }

    scheduleSaveDraft();
  } catch (error) {
    setProblemStatus("同步失败");
    output.textContent = "同步题目失败：" + (error.message || String(error));
  } finally {
    syncButton.disabled = false;
    updateActionStates();
  }
}

async function runAI(mode) {
  if (activeAiRequest) {
    output.textContent = "已有 AI 请求正在运行，可以先点击“停止”。";
    return;
  }

  const problem = sanitizeText(problemInput.value) || lastProblemContext;
  const code = codeInput.value;
  const cursorOffset = typeof codeInput.selectionStart === "number" ? codeInput.selectionStart : code.length;
  const selectionStart = Math.min(getSelectionStart(), getSelectionEnd());
  const selectionEnd = Math.max(getSelectionStart(), getSelectionEnd());
  const selectedCode = code.slice(selectionStart, selectionEnd);
  const cursorPosition = getCursorPosition(cursorOffset);
  const selectionStartPosition = getCursorPosition(selectionStart);
  const selectionEndPosition = getCursorPosition(selectionEnd);
  const isExplainSelection = mode === "explain-selection";

  if (isExplainSelection && !selectedCode.trim()) {
    output.textContent = "请先选中要解释的代码。";
    codeInput.focus();
    return;
  }

  if (!problem && !isExplainSelection) {
    output.textContent = "没有题目上下文，请先同步题目。";
    return;
  }

  const scopeDetails = mode === "next"
    ? buildSuggestionScopeDetails(code, cursorOffset)
    : null;
  const codeBeforeCursor = code.slice(0, cursorOffset);
  const scopedCodeBeforeCursor = scopeDetails && scopeDetails.context
    ? "[建议范围上下文]\n" + scopeDetails.context + "\n\n[光标前代码]\n" + codeBeforeCursor
    : codeBeforeCursor;

  const request = {
    id: "external-editor-" + Date.now() + "-" + (++aiRequestSequence),
    canceled: false
  };
  activeAiRequest = request;
  setAiRunning(true);
  output.textContent = getAiLoadingText(mode);

  try {
    const messages = window.CodingAssistantCore.buildMessages({
      mode,
      problem,
      code,
      selectedCode,
      fullCodeWithLineNumbers: buildLineNumberedCode(code),
      codeBeforeCursor: scopedCodeBeforeCursor,
      codeAfterCursor: code.slice(cursorOffset),
      cursorLine: cursorPosition.line,
      cursorColumn: cursorPosition.column,
      selectionStartLine: selectionStartPosition.line,
      selectionStartColumn: selectionStartPosition.column,
      selectionEndLine: selectionEndPosition.line,
      selectionEndColumn: selectionEndPosition.column,
      language: languageSelect.value,
      suggestionScope: scopeDetails && scopeDetails.scope,
      suggestionScopeLabel: scopeDetails && scopeDetails.label,
      suggestionScopeInstruction: scopeDetails && scopeDetails.instruction,
      suggestionScopeContext: scopeDetails && scopeDetails.context,
      lastResult: output.textContent
    });

    const response = await sendRuntimeMessage({
      type: "CALL_CODING_AI",
      requestId: request.id,
      messages
    });

    if (request.canceled) {
      output.textContent = "已停止生成。";
      return;
    }

    output.textContent = response.answer || "";
    lastSuggestion = mode === "next"
      ? window.CodingAssistantCore.extractSuggestedCode(response.answer)
      : "";
    scheduleSaveDraft();
  } catch (error) {
    output.textContent = request.canceled ? "已停止生成。" : (error.message || String(error));
  } finally {
    if (activeAiRequest === request) {
      activeAiRequest = null;
      setAiRunning(false);
    }
  }
}

function cancelActiveAiRequest() {
  const request = activeAiRequest;

  if (!request || request.canceled) {
    return;
  }

  request.canceled = true;
  stopButton.disabled = true;
  output.textContent = "正在停止生成...";

  sendRuntimeMessage({
    type: "CANCEL_CODING_AI",
    requestId: request.id
  }).catch(() => {
    // The original request will settle and restore the controls.
  });
}

function insertSuggestionAtCursor() {
  const suggestion = getInsertableSuggestion();

  if (!suggestion) {
    output.textContent = "当前没有可插入的建议代码。";
    return;
  }

  const start = getSelectionStart();
  const end = getSelectionEnd();
  codeInput.setRangeText(prepareInsertedCode(suggestion, codeInput.value, start, end), start, end, "end");
  codeInput.dispatchEvent(new Event("input", { bubbles: true }));
  codeInput.focus();
}

async function insertCodeIntoSourcePage() {
  const text = codeInput.value;

  if (!text.trim()) {
    output.textContent = "没有可插入的代码。";
    return;
  }

  insertPageButton.disabled = true;

  try {
    const response = await sendRuntimeMessage({
      type: "INSERT_EXTERNAL_EDITOR_CODE",
      tabId: sourceTabId,
      text
    });

    if (response.inserted) {
      output.textContent = "已插入到源页面。" + (response.method ? " 方法：" + response.method : "");
    } else if (response.method === "clipboard") {
      output.textContent = "直接插入失败，代码已复制到剪贴板。请回到页面编辑器手动粘贴。";
    } else {
      output.textContent = "源页面没有确认插入。";
    }
  } catch (error) {
    output.textContent = "插入到页面失败：" + (error.message || String(error));
  } finally {
    insertPageButton.disabled = false;
  }
}

function formatCodeInEditor() {
  const code = codeInput.value;
  const nextCode = code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n");

  if (nextCode === code) {
    output.textContent = "当前代码不需要基础格式化。";
    return;
  }

  const start = getSelectionStart();
  const end = getSelectionEnd();
  codeInput.value = nextCode;
  codeInput.setSelectionRange(Math.min(start, nextCode.length), Math.min(end, nextCode.length));
  codeInput.dispatchEvent(new Event("input", { bubbles: true }));
  output.textContent = "已完成基础格式化。";
}

function handleCodeKeydown(event) {
  if (event.key === "Tab") {
    event.preventDefault();
    insertAtSelection(event.shiftKey ? "" : "  ", event.shiftKey);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    insertNewlineWithIndent();
    return;
  }

  const pairs = {
    "(": ")",
    "[": "]",
    "{": "}",
    "\"": "\"",
    "'": "'"
  };

  if (pairs[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    insertPair(event.key, pairs[event.key]);
  }
}

function insertAtSelection(text, outdent) {
  const start = getSelectionStart();
  const end = getSelectionEnd();
  const value = codeInput.value;

  if (outdent) {
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const removable = value.slice(lineStart, lineStart + 2) === "  " ? 2 : value[lineStart] === "\t" ? 1 : 0;

    if (removable > 0) {
      codeInput.setRangeText("", lineStart, lineStart + removable, "start");
    }
  } else {
    codeInput.setRangeText(text, start, end, "end");
  }

  codeInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertNewlineWithIndent() {
  const start = getSelectionStart();
  const end = getSelectionEnd();
  const value = codeInput.value;
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const currentLine = value.slice(lineStart, start);
  const indent = currentLine.match(/^\s*/)[0];
  const extra = /[\{\[\(]\s*$/.test(currentLine) ? "  " : "";

  codeInput.setRangeText("\n" + indent + extra, start, end, "end");
  codeInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertPair(open, close) {
  const start = getSelectionStart();
  const end = getSelectionEnd();
  const selected = codeInput.value.slice(start, end);

  codeInput.setRangeText(open + selected + close, start, end, "end");
  codeInput.setSelectionRange(start + 1, end + 1);
  codeInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateEditorMetrics() {
  const code = codeInput.value || "";
  const lineCount = Math.max(1, code.split("\n").length);
  const digits = String(lineCount).length;
  const lines = [];

  for (let index = 1; index <= lineCount; index += 1) {
    lines.push(String(index).padStart(digits, " "));
  }

  lineNumbers.textContent = lines.join("\n");
  syncCodeScroll();

  const position = getCursorPosition(getSelectionStart());
  cursorStatus.textContent = "第 " + position.line + " 行，第 " + position.column + " 列";
}

function syncCodeScroll() {
  lineNumbers.scrollTop = codeInput.scrollTop;
}

function updateActionStates() {
  const hasSelection = getSelectionStart() !== getSelectionEnd();
  explainButton.disabled = activeAiRequest || !hasSelection;
  insertSuggestionButton.disabled = activeAiRequest || !getInsertableSuggestion();
}

function setAiRunning(running) {
  nextButton.disabled = running;
  checkButton.disabled = running;
  explainButton.disabled = running || getSelectionStart() === getSelectionEnd();
  insertSuggestionButton.disabled = running || !getInsertableSuggestion();
  formatButton.disabled = running;
  syncButton.disabled = running;
  stopButton.hidden = !running;
  stopButton.disabled = false;

  if (!running) {
    updateActionStates();
  }
}

function getInsertableSuggestion() {
  if (lastSuggestion && lastSuggestion.trim()) {
    return lastSuggestion;
  }

  const text = output.textContent || "";

  if (!text.includes("建议代码：")) {
    return "";
  }

  return window.CodingAssistantCore.extractSuggestedCode(text);
}

function buildSuggestionScopeDetails(code, cursorOffset) {
  const scope = suggestionScopeSelect.value || "small";
  const config = SCOPE_CONFIG[scope] || SCOPE_CONFIG.small;

  return {
    scope,
    label: config.label,
    instruction: config.instruction,
    context: extractCursorWindowContext(code, cursorOffset, config.before, config.after)
  };
}

function extractCursorWindowContext(code, cursorOffset, beforeCount, afterCount) {
  const lines = String(code || "").split("\n");
  const lineIndex = getLineIndexAtOffset(code, cursorOffset);
  const start = Math.max(0, lineIndex - beforeCount);
  const end = Math.min(lines.length, lineIndex + afterCount + 1);
  const digits = String(end).length;

  return lines
    .slice(start, end)
    .map((line, index) => String(start + index + 1).padStart(digits, " ") + " | " + line)
    .join("\n");
}

function buildLineNumberedCode(code) {
  const lines = String(code || "").split("\n");
  const digits = String(Math.max(1, lines.length)).length;

  return lines
    .map((line, index) => String(index + 1).padStart(digits, " ") + " | " + line)
    .join("\n");
}

function getCursorPosition(offset) {
  const text = codeInput.value.slice(0, Math.max(0, offset));
  const lines = text.split("\n");

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

function getLineIndexAtOffset(code, offset) {
  return String(code || "").slice(0, Math.max(0, offset)).split("\n").length - 1;
}

function prepareInsertedCode(suggestion, code, start, end) {
  const text = String(suggestion || "").replace(/\r\n?/g, "\n");
  const before = String(code || "").slice(0, start);
  const after = String(code || "").slice(end);
  const prefix = before && !before.endsWith("\n") && text && !text.startsWith("\n") ? "\n" : "";
  const suffix = after && !after.startsWith("\n") && text && !text.endsWith("\n") ? "\n" : "";

  return prefix + text + suffix;
}

function getAiLoadingText(mode) {
  if (mode === "check") {
    return "正在检查代码...";
  }

  if (mode === "explain-selection") {
    return "正在解释选中代码...";
  }

  return "正在生成下一段建议...";
}

function scheduleSaveDraft() {
  if (isApplyingRemoteDraft) {
    return;
  }

  saveStatus.textContent = "正在保存...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 180);
}

function saveDraft() {
  const draftKey = getDraftKey();

  if (!draftKey) {
    return Promise.resolve(null);
  }

  const payload = createDraftPayload(Date.now());
  isSavingDraft = true;

  return new Promise((resolve) => {
    chrome.storage.local.set({
      [draftKey]: payload
    }, () => {
      isSavingDraft = false;
      saveStatus.textContent = "草稿已保存 " + new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
      resolve(payload);
    });
  });
}

function createDraftPayload(savedAt) {
  return {
    version: DRAFT_VERSION,
    problem: problemInput.value,
    code: codeInput.value,
    language: languageSelect.value,
    suggestionScope: suggestionScopeSelect.value,
    source: lastServerSource,
    leetcodeTemplateCode: loadedLeetCodeTemplateCode,
    leetcodeTemplateUrl: loadedLeetCodeTemplateUrl,
    leetcodeTemplateLanguage: loadedLeetCodeTemplateLanguage,
    history: loadedDraftHistory,
    externalOutput: output.textContent,
    savedAt
  };
}

function loadDraft(seedDraft) {
  return new Promise((resolve) => {
    const draftKey = getDraftKey();

    if (!draftKey) {
      applyDraft(seedDraft);
      resolve();
      return;
    }

    chrome.storage.local.get([draftKey, getLegacyDraftKey()], (items) => {
      const draft = chooseNewestDraft(items[draftKey], seedDraft, items[getLegacyDraftKey()]);

      if (applyDraft(draft)) {
        saveStatus.textContent = "草稿已恢复";
      }

      updateEditorMetrics();
      updateActionStates();
      resolve();
    });
  });
}

function chooseNewestDraft(...drafts) {
  return drafts
    .filter(Boolean)
    .sort((left, right) => (Number(right.savedAt) || 0) - (Number(left.savedAt) || 0))[0] || null;
}

function applyDraft(draft) {
  if (!draft || (draft.version !== DRAFT_VERSION && draft.version !== 1)) {
    return false;
  }

  isApplyingRemoteDraft = true;
  problemInput.value = draft.problem || "";
  codeInput.value = draft.code || "";
  languageSelect.value = draft.language || "auto";
  suggestionScopeSelect.value = draft.suggestionScope || "small";
  output.textContent = draft.externalOutput || draft.output || output.textContent || "准备就绪";
  lastProblemContext = draft.problem || "";
  lastServerSource = draft.source || "Page Content";
  loadedDraftHistory = Array.isArray(draft.history) ? draft.history : [];
  loadedLeetCodeTemplateCode = draft.leetcodeTemplateCode || "";
  loadedLeetCodeTemplateUrl = draft.leetcodeTemplateUrl || "";
  loadedLeetCodeTemplateLanguage = draft.leetcodeTemplateLanguage || "";
  isApplyingRemoteDraft = false;

  return true;
}

function getDraftKey() {
  return sharedDraftKey || getLegacyDraftKey();
}

function getLegacyDraftKey() {
  return "external-editor:draft:" + (sourceTabId || "unknown");
}

function buildDraftKeyFromUrl(value) {
  try {
    const url = new URL(value || "");

    if (!url.origin || !url.pathname) {
      return "";
    }

    return "draft:" + url.origin + url.pathname;
  } catch {
    return "";
  }
}

function updateSourceTitle() {
  const title = sourceTab.title || sourceTab.url || (sourceTab.id ? "标签页 " + sourceTab.id : "等待连接");
  sourceTitle.textContent = "源页面：" + title;
  sourceTitle.title = sourceTab.url || title;
}

function setProblemStatus(text) {
  problemStatus.textContent = text;
}

function sanitizeText(value) {
  return String(value || "").replace(/\u0000/g, "").trim();
}

function getSelectionStart() {
  return typeof codeInput.selectionStart === "number" ? codeInput.selectionStart : codeInput.value.length;
}

function getSelectionEnd() {
  return typeof codeInput.selectionEnd === "number" ? codeInput.selectionEnd : codeInput.value.length;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || !response.ok) {
        reject(new Error(response && response.error ? response.error : "请求失败"));
        return;
      }

      resolve(response);
    });
  });
}
