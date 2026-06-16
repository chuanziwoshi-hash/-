importScripts("ai-request-registry.js");

const DEFAULT_SETTINGS = {
  apiEndpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  timeoutSeconds: 90,
  problemSource: "auto",
  problemServerEndpoint: "",
  problemServerToken: ""
};

const PROBLEM_TEXT_LIMIT = 30000;
const LEETCODE_QUESTION_QUERY = [
  "query questionData($titleSlug: String!) {",
  "  question(titleSlug: $titleSlug) {",
  "    questionId",
  "    questionFrontendId",
  "    title",
  "    translatedTitle",
  "    content",
  "    translatedContent",
  "    difficulty",
  "    hints",
  "    topicTags {",
  "      name",
  "      translatedName",
  "    }",
  "  }",
  "}"
].join("\n");

const EXTERNAL_EDITOR_PATH = "frontend/editor/editor.html";
const EXTERNAL_EDITOR_WIDTH = 980;
const EXTERNAL_EDITOR_HEIGHT = 760;
const EXTERNAL_EDITOR_WINDOW_STORE_KEY = "externalEditorWindowsByTabId";
const externalEditorWindowsByTabId = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "coding-assistant-open",
      title: "打开 码伴 CodeMate",
      contexts: ["page", "selection", "editable"]
    });
    chrome.contextMenus.create({
      id: "coding-assistant-open-external",
      title: "在独立窗口打开 码伴 CodeMate",
      contexts: ["page", "selection", "editable"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) {
    return;
  }

  if (info.menuItemId === "coding-assistant-open-external") {
    openExternalEditorForTab(tab).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        type: "OPEN_CODING_ASSISTANT",
        selectionText: info.selectionText || ""
      });
    });
    return;
  }

  chrome.tabs.sendMessage(tab.id, {
    type: "OPEN_CODING_ASSISTANT",
    selectionText: info.selectionText || ""
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-external-editor") {
    return;
  }

  toggleExternalEditorForCommand()
    .catch(() => {
      // Ignore background command failures; the user can still use the popup or page button.
    });
});

chrome.windows.onRemoved.addListener((windowId) => {
  forgetExternalEditorWindow(windowId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "OPEN_EXTERNAL_EDITOR") {
    resolveExternalEditorSourceTab(message, sender)
      .then((tab) => openExternalEditorForTab(tab))
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "GET_EXTERNAL_EDITOR_PAGE_CONTEXT") {
    getExternalEditorPageContext(message.tabId)
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "INSERT_EXTERNAL_EDITOR_CODE") {
    insertExternalEditorCode(message.tabId, message.text || "")
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "CALL_CODING_AI" || message.type === "TEST_CODING_AI") {
    const messages = message.type === "TEST_CODING_AI"
      ? [{ role: "user", content: "请只回复：连接成功" }]
      : message.messages;

    const requestId = message.type === "CALL_CODING_AI" ? String(message.requestId || "") : "";
    const request = CodingAiRequestRegistry.create(requestId);

    callCodingAI(messages, { signal: request.signal })
      .then((answer) => {
        sendResponse({ ok: true, answer });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      })
      .finally(() => {
        CodingAiRequestRegistry.finish(request.requestId, request.controller);
      });

    return true;
  }

  if (message.type === "CANCEL_CODING_AI") {
    const canceled = CodingAiRequestRegistry.cancel(message.requestId);
    sendResponse({ ok: true, canceled });
    return false;
  }

  if (message.type === "FETCH_PROBLEM_CONTEXT") {
    fetchProblemContextV3(message.payload || {})
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "TEST_PROBLEM_SERVER") {
    testProblemSource()
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "INSERT_LEETCODE_CODE") {
    insertLeetCodeCodeIntoTab(getTargetTabId(message, sender), message.text || "")
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "PASTE_LEETCODE_CODE") {
    pasteLeetCodeCodeIntoTab(getTargetTabId(message, sender), message.text || "")
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "CAPTURE_LEETCODE_CODE_SNAPSHOT") {
    captureLeetCodeCodeSnapshotFromTab(getTargetTabId(message, sender))
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  if (message.type === "RESTORE_LEETCODE_CODE_SNAPSHOT") {
    restoreLeetCodeCodeSnapshotInTab(getTargetTabId(message, sender), message.text || "")
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  }

  return false;
});

function getTargetTabId(message, sender) {
  const messageTabId = Number(message && message.tabId);

  if (Number.isInteger(messageTabId) && messageTabId > 0) {
    return messageTabId;
  }

  return sender && sender.tab && sender.tab.id;
}

async function resolveExternalEditorSourceTab(message, sender) {
  const explicitTabId = getTargetTabId(message, sender);

  if (explicitTabId) {
    return getTabById(explicitTabId);
  }

  const tabs = await queryTabs({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];

  if (!tab || !tab.id) {
    throw new Error("No active tab found for the external editor.");
  }

  const editorSourceTabId = getExternalEditorSourceTabId(tab.url);

  if (editorSourceTabId) {
    return getTabById(editorSourceTabId);
  }

  return tab;
}

async function toggleExternalEditorForCommand() {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  const activeTab = tabs && tabs[0];
  const activeEditorSourceTabId = getExternalEditorSourceTabId(activeTab && activeTab.url);

  if (activeEditorSourceTabId && activeTab && activeTab.windowId) {
    const closed = await closeExternalEditorWindowsForTab(activeEditorSourceTabId, [{
      tabId: activeTab.id,
      windowId: activeTab.windowId
    }]);

    return {
      action: "closed",
      tabId: activeEditorSourceTabId,
      windowId: closed.windowId || activeTab.windowId
    };
  }

  const tab = await resolveExternalEditorSourceTab({}, null);
  return toggleExternalEditorForTab(tab);
}

async function toggleExternalEditorForTab(tab) {
  if (!tab || !tab.id) {
    throw new Error("No source tab found for the external editor.");
  }

  const existingEditors = await findExternalEditorTabsForSourceTab(tab.id);

  if (existingEditors.length) {
    const closed = await closeExternalEditorWindowsForTab(tab.id, existingEditors);

    if (closed.closed) {
      return {
        action: "closed",
        tabId: tab.id,
        windowId: closed.windowId
      };
    }
  }

  return openExternalEditorForTab(tab);
}

async function openExternalEditorForTab(tab) {
  if (!tab || !tab.id) {
    throw new Error("No source tab found for the external editor.");
  }

  const existingEditor = await focusExistingExternalEditor(tab.id);

  if (existingEditor) {
    return {
      action: "focused",
      tabId: tab.id,
      windowId: existingEditor.windowId
    };
  }

  const url = chrome.runtime.getURL(EXTERNAL_EDITOR_PATH + "?tabId=" + encodeURIComponent(String(tab.id)));
  const createdWindow = await createWindow({
    url,
    type: "popup",
    width: EXTERNAL_EDITOR_WIDTH,
    height: EXTERNAL_EDITOR_HEIGHT,
    focused: true
  });
  const createdWindowId = createdWindow && createdWindow.id;

  rememberExternalEditorWindow(tab.id, createdWindowId);

  return {
    action: "opened",
    tabId: tab.id,
    windowId: createdWindowId
  };
}

async function focusExistingExternalEditor(tabId) {
  const editors = await findExternalEditorTabsForSourceTab(tabId);

  for (const editor of editors) {
    if (!isPositiveInteger(editor.windowId)) {
      continue;
    }

    try {
      await focusWindow(editor.windowId);
      rememberExternalEditorWindow(tabId, editor.windowId);
      return editor;
    } catch {
      forgetExternalEditorWindow(editor.windowId);
    }
  }

  return null;
}

async function closeExternalEditorWindowsForTab(tabId, editors) {
  const targets = editors && editors.length
    ? dedupeExternalEditorTabs(editors)
    : await findExternalEditorTabsForSourceTab(tabId);
  let closedWindowId = null;

  if (!targets.length) {
    return { closed: false, windowId: null };
  }

  await flushExternalEditorDraft(tabId).catch(() => null);

  for (const target of targets) {
    if (!isPositiveInteger(target.windowId)) {
      continue;
    }

    try {
      await removeWindow(target.windowId);
      closedWindowId = closedWindowId || target.windowId;
    } catch {
      // The window may already be gone; forget the stale reference below.
    } finally {
      forgetExternalEditorWindow(target.windowId);
    }
  }

  return {
    closed: Boolean(closedWindowId),
    windowId: closedWindowId
  };
}

async function findExternalEditorTabsForSourceTab(tabId) {
  const sourceTabId = normalizeTabId(tabId);
  const candidates = [];
  const trackedWindowId = externalEditorWindowsByTabId.get(sourceTabId);

  if (isPositiveInteger(trackedWindowId)) {
    candidates.push({ tabId: null, windowId: trackedWindowId });
    return candidates;
  }

  const storedWindowId = await getStoredExternalEditorWindowId(sourceTabId);

  if (isPositiveInteger(storedWindowId)) {
    candidates.push({ tabId: null, windowId: storedWindowId });
    return candidates;
  }

  const editorTabs = await queryTabs({
    url: chrome.runtime.getURL(EXTERNAL_EDITOR_PATH) + "*"
  }).catch(() => []);

  for (const editorTab of editorTabs) {
    if (getExternalEditorSourceTabId(editorTab && editorTab.url) !== sourceTabId) {
      continue;
    }

    if (!isPositiveInteger(editorTab.windowId)) {
      continue;
    }

    candidates.push({
      tabId: editorTab.id,
      windowId: editorTab.windowId
    });
    rememberExternalEditorWindow(sourceTabId, editorTab.windowId);
  }

  return dedupeExternalEditorTabs(candidates);
}

function dedupeExternalEditorTabs(editors) {
  const seenWindowIds = new Set();
  const uniqueEditors = [];

  for (const editor of editors || []) {
    if (!isPositiveInteger(editor && editor.windowId) || seenWindowIds.has(editor.windowId)) {
      continue;
    }

    seenWindowIds.add(editor.windowId);
    uniqueEditors.push(editor);
  }

  return uniqueEditors;
}

function getExternalEditorSourceTabId(url) {
  try {
    const parsedUrl = new URL(url || "");
    const editorUrl = new URL(chrome.runtime.getURL(EXTERNAL_EDITOR_PATH));

    if (parsedUrl.origin !== editorUrl.origin || parsedUrl.pathname !== editorUrl.pathname) {
      return 0;
    }

    const tabId = Number(parsedUrl.searchParams.get("tabId"));
    return isPositiveInteger(tabId) ? tabId : 0;
  } catch {
    return 0;
  }
}

function rememberExternalEditorWindow(tabId, windowId) {
  if (!isPositiveInteger(tabId) || !isPositiveInteger(windowId)) {
    return;
  }

  externalEditorWindowsByTabId.set(tabId, windowId);
  persistExternalEditorWindows().catch(() => null);
}

function forgetExternalEditorWindow(windowId) {
  if (!isPositiveInteger(windowId)) {
    return;
  }

  for (const [tabId, trackedWindowId] of externalEditorWindowsByTabId.entries()) {
    if (trackedWindowId === windowId) {
      externalEditorWindowsByTabId.delete(tabId);
    }
  }

  persistExternalEditorWindows().catch(() => null);
}

async function getStoredExternalEditorWindowId(tabId) {
  if (!chrome.storage || !chrome.storage.session || !isPositiveInteger(tabId)) {
    return 0;
  }

  const items = await storageSessionGet([EXTERNAL_EDITOR_WINDOW_STORE_KEY]).catch(() => ({}));
  const storedWindows = items[EXTERNAL_EDITOR_WINDOW_STORE_KEY] || {};
  const windowId = Number(storedWindows[String(tabId)]);

  if (isPositiveInteger(windowId)) {
    externalEditorWindowsByTabId.set(tabId, windowId);
    return windowId;
  }

  return 0;
}

async function persistExternalEditorWindows() {
  if (!chrome.storage || !chrome.storage.session) {
    return;
  }

  const storedWindows = {};

  for (const [tabId, windowId] of externalEditorWindowsByTabId.entries()) {
    if (isPositiveInteger(tabId) && isPositiveInteger(windowId)) {
      storedWindows[String(tabId)] = windowId;
    }
  }

  await storageSessionSet({
    [EXTERNAL_EDITOR_WINDOW_STORE_KEY]: storedWindows
  });
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

async function flushExternalEditorDraft(tabId) {
  if (!isPositiveInteger(tabId)) {
    return null;
  }

  return sendRuntimeMessage({
    type: "FLUSH_EXTERNAL_EDITOR_DRAFT",
    tabId
  });
}

async function getExternalEditorPageContext(tabId) {
  const targetTabId = normalizeTabId(tabId);
  const tab = await getTabById(targetTabId);
  const fallbackPayload = buildFallbackPagePayload(tab);

  try {
    const response = await sendMessageToTab(targetTabId, {
      type: "GET_CODING_ASSISTANT_PAGE_CONTEXT"
    });

    return {
      tab: buildSourceTabInfo(tab),
      draftKey: response.draftKey || buildDraftKeyFromTab(tab),
      draft: response.draft || null,
      payload: response.payload || fallbackPayload,
      localProblem: response.localProblem || "",
      draftCode: response.code || "",
      language: response.language || "auto"
    };
  } catch (error) {
    return {
      tab: buildSourceTabInfo(tab),
      draftKey: buildDraftKeyFromTab(tab),
      draft: null,
      payload: fallbackPayload,
      localProblem: "",
      draftCode: "",
      language: "auto",
      warning: error.message || String(error)
    };
  }
}

async function insertExternalEditorCode(tabId, text) {
  const targetTabId = normalizeTabId(tabId);

  if (!String(text || "").trim()) {
    throw new Error("No code to insert.");
  }

  const response = await sendMessageToTab(targetTabId, {
    type: "INSERT_CODE_FROM_EXTERNAL_EDITOR",
    text
  });

  return {
    inserted: Boolean(response.inserted),
    method: response.method || "content-script"
  };
}

function normalizeTabId(tabId) {
  const value = Number(tabId);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Invalid source tab for the external editor.");
  }

  return value;
}

function buildFallbackPagePayload(tab) {
  return {
    pageUrl: tab && tab.url ? tab.url : "",
    pageTitle: tab && tab.title ? tab.title : "",
    pageText: "",
    selection: "",
    code: "",
    language: "auto",
    platform: "",
    problemId: ""
  };
}

function buildSourceTabInfo(tab) {
  return {
    id: tab && tab.id,
    title: tab && tab.title ? tab.title : "",
    url: tab && tab.url ? tab.url : ""
  };
}

function buildDraftKeyFromTab(tab) {
  try {
    const url = new URL(tab && tab.url ? tab.url : "");

    if (!url.origin || !url.pathname) {
      return "";
    }

    return "draft:" + url.origin + url.pathname;
  } catch {
    return "";
  }
}

function getTabById(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!tab || !tab.id) {
        reject(new Error("Source tab is no longer available."));
        return;
      }

      resolve(tab);
    });
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(tabs || []);
    });
  });
}

function storageSessionGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(items || {});
    });
  });
}

function storageSessionSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function createWindow(options) {
  return new Promise((resolve, reject) => {
    chrome.windows.create(options, (createdWindow) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(createdWindow || {});
    });
  });
}

function focusWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, { focused: true }, (updatedWindow) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(updatedWindow || {});
    });
  });
}

function removeWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.remove(windowId, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || response.ok === false) {
        reject(new Error(response && response.error ? response.error : "Request failed."));
        return;
      }

      resolve(response);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || response.ok === false) {
        reject(new Error(response && response.error ? response.error : "Request failed."));
        return;
      }

      resolve(response);
    });
  });
}

async function callCodingAI(messages, options = {}) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const apiEndpoint = String(settings.apiEndpoint || "").trim();
  const apiKey = String(settings.apiKey || "").trim();
  const model = String(settings.model || "").trim();
  const timeoutSeconds = normalizeTimeout(settings.timeoutSeconds);

  if (!apiEndpoint) {
    throw new Error("AI 接口地址为空。请在插件弹窗中填写地址，例如 https://api.openai.com/v1/chat/completions。");
  }

  if (!model) {
    throw new Error("模型名称为空。请在插件弹窗中填写模型名称。");
  }

  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = "Bearer " + apiKey;
  }

  const response = await fetchWithTimeout(apiEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: getMaxTokens(messages),
      stream: false
    })
  }, timeoutSeconds, "AI 请求", {
    signal: options.signal,
    abortMessage: "AI 请求已停止。"
  });

  const rawText = await response.text();
  const data = safeParseJson(rawText);

  if (looksLikeHtml(rawText)) {
    throw new Error("AI 接口返回的是网页 HTML，不是模型接口。请确认地址是 OpenAI 兼容的 /v1/chat/completions 接口。");
  }

  if (!response.ok) {
    const message = getErrorMessage(data, rawText) || "AI 请求失败，状态码：" + response.status;
    throw new Error(message);
  }

  const answer = extractAnswer(data, rawText);

  if (!answer) {
    throw new Error("AI 没有返回内容。请确认接口兼容 OpenAI Chat Completions 格式，或检查模型名称是否正确。");
  }

  return answer.trim();
}

async function insertLeetCodeCodeIntoTab(tabId, text) {
  if (!tabId) {
    throw new Error("No active tab found for LeetCode insertion.");
  }

  if (!chrome.scripting || !chrome.scripting.executeScript) {
    throw new Error("chrome.scripting is unavailable. Reload the extension after updating permissions.");
  }

  const preparedText = prepareLeetCodeInsertText(text);
  const result = await runLeetCodeMainWorldInsert(tabId, preparedText);

  return {
    inserted: true,
    method: result.method || "main-world"
  };
}

async function captureLeetCodeCodeSnapshotFromTab(tabId) {
  if (!tabId) {
    throw new Error("No active tab found for LeetCode snapshot.");
  }

  if (!chrome.scripting || !chrome.scripting.executeScript) {
    throw new Error("chrome.scripting is unavailable. Reload the extension after updating permissions.");
  }

  const result = await runLeetCodeMainWorldSnapshot(tabId);

  return {
    text: result.text || "",
    languageId: result.languageId || "",
    method: result.method || "main-world"
  };
}

async function restoreLeetCodeCodeSnapshotInTab(tabId, text) {
  if (!tabId) {
    throw new Error("No active tab found for LeetCode restore.");
  }

  if (!chrome.scripting || !chrome.scripting.executeScript) {
    throw new Error("chrome.scripting is unavailable. Reload the extension after updating permissions.");
  }

  const preparedText = prepareLeetCodeInsertText(text);
  const result = await runLeetCodeMainWorldInsert(tabId, preparedText, { allowEmpty: true });

  return {
    restored: true,
    method: result.method || "main-world"
  };
}

function prepareLeetCodeInsertText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n");
}

async function runLeetCodeMainWorldInsert(tabId, text, options = {}) {
  const delays = [0, 120, 350];
  let lastError = "LeetCode main-world insertion failed.";

  for (const delay of delays) {
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: insertLeetCodeCodeInMainWorld,
        args: [text, options]
      });
      const successfulResult = (results || []).find((item) => item && item.result && item.result.ok);
      const result = successfulResult
        ? successfulResult.result
        : results && results[0] && results[0].result;

      if (result && result.ok) {
        return result;
      }

      lastError = result && result.error ? result.error : lastError;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }

  throw new Error(lastError);
}

async function runLeetCodeMainWorldSnapshot(tabId) {
  const delays = [0, 120, 350];
  let lastError = "LeetCode snapshot failed.";

  for (const delay of delays) {
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: captureLeetCodeCodeSnapshotInMainWorld
      });
      const successfulResult = (results || []).find((item) => item && item.result && item.result.ok);
      const result = successfulResult
        ? successfulResult.result
        : results && results[0] && results[0].result;

      if (result && result.ok) {
        return result;
      }

      lastError = result && result.error ? result.error : lastError;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }

  throw new Error(lastError);
}

async function pasteLeetCodeCodeIntoTab(tabId, text) {
  if (!tabId) {
    throw new Error("No active tab found for LeetCode paste.");
  }

  const preparedText = prepareLeetCodeInsertText(text);
  await sleep(80);
  return await pasteLeetCodeCodeWithDebugger(tabId, preparedText);
}

async function insertLeetCodeCodeWithDebugger(tabId, text) {
  if (!chrome.debugger || !chrome.debugger.attach) {
    throw new Error("chrome.debugger is unavailable. Reload the extension after updating permissions.");
  }

  const focusResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: focusLeetCodeEditorForDebugger
  });
  const rect = focusResults && focusResults[0] && focusResults[0].result;

  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
    throw new Error("Could not locate the visible LeetCode editor for debugger insertion.");
  }

  const debuggee = { tabId };
  let attached = false;

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    await clickDebuggerEditor(debuggee, rect);
    await sleep(60);
    await dispatchDebuggerControlChord(debuggee, "a", "KeyA", 65);
    await chrome.debugger.sendCommand(debuggee, "Input.insertText", { text });

    await sleep(350);

    if (!await verifyLeetCodeInsertion(tabId, text)) {
      throw new Error("Debugger input ran, but the visible LeetCode editor did not change.");
    }

    return {
      inserted: true,
      method: "debugger"
    };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // The tab may have navigated while inserting.
      }
    }
  }
}

async function pasteLeetCodeCodeWithDebugger(tabId, text) {
  if (!chrome.debugger || !chrome.debugger.attach) {
    throw new Error("chrome.debugger is unavailable. Reload the extension after updating permissions.");
  }

  const focusResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: focusLeetCodeEditorForDebugger
  });
  const rect = focusResults && focusResults[0] && focusResults[0].result;

  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
    throw new Error("Could not locate the visible LeetCode editor for debugger paste.");
  }

  const debuggee = { tabId };
  let attached = false;

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    await clickDebuggerEditor(debuggee, rect);
    await sleep(60);
    await dispatchDebuggerControlChord(debuggee, "a", "KeyA", 65);
    await sleep(60);
    await dispatchDebuggerControlChord(debuggee, "v", "KeyV", 86);
    await sleep(450);

    if (!await verifyLeetCodeInsertion(tabId, text)) {
      throw new Error("Debugger paste ran, but the visible LeetCode editor did not change.");
    }

    return {
      inserted: true,
      method: "debugger-paste"
    };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // The tab may have navigated while inserting.
      }
    }
  }
}

async function clickDebuggerEditor(debuggee, rect) {
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1
  });
}

async function dispatchDebuggerControlChord(debuggee, key, code, keyCode) {
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 2
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers: 2
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers: 2
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 0
  });
}

async function verifyLeetCodeInsertion(tabId, text) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: verifyLeetCodeVisibleEditorContains,
    args: [String(text || "")]
  });

  return Boolean(results && results[0] && results[0].result);
}

function verifyLeetCodeVisibleEditorContains(text) {
  var needle = getVerificationNeedle(text);

  if (!needle) {
    return false;
  }

  var editors = Array.prototype.slice.call(document.querySelectorAll([
    ".monaco-editor",
    ".cm-editor",
    "[data-track-load*='code_editor'] .monaco-editor",
    "[data-track-load*='code_editor'] .cm-editor",
    "[class*='monaco']",
    ".CodeMirror"
  ].join(","))).filter(isVisibleElement);

  for (var index = 0; index < editors.length; index += 1) {
    var visibleText = normalizeText(editors[index].innerText || editors[index].textContent || "");

    if (visibleText.indexOf(needle) >= 0) {
      return true;
    }
  }

  var activeText = normalizeText(document.activeElement && (document.activeElement.value || document.activeElement.innerText || document.activeElement.textContent || ""));
  return activeText.indexOf(needle) >= 0;

  function getVerificationNeedle(value) {
    var lines = String(value || "")
      .split(/\r?\n/)
      .map(function (line) {
        return normalizeText(line);
      })
      .filter(Boolean);

    return lines[0] ? lines[0].slice(0, 80) : "";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisibleElement(node) {
    if (!node || !node.getBoundingClientRect) {
      return false;
    }

    var rect = node.getBoundingClientRect();
    var style = window.getComputedStyle(node);

    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function focusLeetCodeEditorForDebugger() {
  var editor = findVisibleEditor();

  if (!editor) {
    return null;
  }

  var target = editor.querySelector("textarea.inputarea") ||
    editor.querySelector("textarea") ||
    editor.querySelector(".cm-content[contenteditable='true']") ||
    editor.querySelector("[contenteditable='true']") ||
    editor;

  editor.scrollIntoView({ block: "center", inline: "center" });

  if (target && typeof target.focus === "function") {
    target.focus();
  }

  var rect = editor.getBoundingClientRect();

  return {
    x: rect.left + Math.min(Math.max(rect.width / 2, 24), Math.max(rect.width - 24, 24)),
    y: rect.top + Math.min(Math.max(rect.height / 2, 24), Math.max(rect.height - 24, 24))
  };

  function findVisibleEditor() {
    var selectors = [
      ".monaco-editor",
      ".cm-editor",
      "[data-track-load*='code_editor'] .monaco-editor",
      "[data-track-load*='code_editor'] .cm-editor",
      "[class*='monaco']",
      ".CodeMirror",
      "[contenteditable='true']"
    ];

    for (var index = 0; index < selectors.length; index += 1) {
      var nodes = Array.prototype.slice.call(document.querySelectorAll(selectors[index]))
        .filter(isVisibleElement);

      if (nodes.length > 0) {
        return nodes[nodes.length - 1];
      }
    }

    return null;
  }

  function isVisibleElement(node) {
    if (!node || !node.getBoundingClientRect) {
      return false;
    }

    var rect = node.getBoundingClientRect();
    var style = window.getComputedStyle(node);

    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  }
}

async function insertLeetCodeCodeInMainWorld(text, options) {
  try {
    var preparedText = prepareLeetCodeInsertText(text);
    var allowEmpty = Boolean(options && options.allowEmpty);

    if (!preparedText && !allowEmpty) {
      throw new Error("No code to insert.");
    }

    if (await insertWithMonaco(preparedText)) {
      return { ok: true, method: "monaco" };
    }

    if (insertWithCodeMirror(preparedText)) {
      return { ok: true, method: "codemirror" };
    }

    if (insertWithEditorDom(preparedText)) {
      return { ok: true, method: "dom" };
    }

    throw new Error("Could not find a visible LeetCode editor.");
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }

  function prepareLeetCodeInsertText(value) {
    return String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n");
  }

  async function insertWithMonaco(code) {
    var monaco = await resolveMonaco();

    if (!monaco || !monaco.editor || typeof monaco.editor.getModels !== "function") {
      return false;
    }

    var editors = getRankedMonacoEditors(monaco);

    for (var index = 0; index < editors.length; index += 1) {
      if (replaceMonacoEditorValue(editors[index], code)) {
        return true;
      }
    }

    var model = chooseLeetCodeModel(monaco.editor.getModels());

    return replaceMonacoModelValue(model, code);
  }

  function resolveMonaco() {
    if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getModels === "function") {
      return Promise.resolve(window.monaco);
    }

    if (typeof window.require !== "function") {
      return Promise.resolve(null);
    }

    return new Promise(function (resolve) {
      var finished = false;
      var timeoutId = setTimeout(function () {
        finish(null);
      }, 800);

      function finish(value) {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeoutId);
        resolve(value);
      }

      try {
        var direct = window.require("vs/editor/editor.main");

        if (window.monaco && window.monaco.editor) {
          finish(window.monaco);
          return;
        }

        if (direct && direct.editor) {
          finish(direct);
          return;
        }
      } catch {
        // Fall through to AMD async require.
      }

      try {
        window.require(["vs/editor/editor.main"], function () {
          finish(window.monaco || null);
        });
      } catch {
        finish(null);
      }
    });
  }

  function getMonacoEditors(monaco) {
    var editors = [];

    if (typeof monaco.editor.getEditors === "function") {
      editors = monaco.editor.getEditors();
    } else if (Array.isArray(monaco.editor._editors)) {
      editors = monaco.editor._editors;
    }

    return editors.filter(Boolean);
  }

  function getRankedMonacoEditors(monaco) {
    return getMonacoEditors(monaco)
      .map(function (editor) {
        return {
          editor: editor,
          score: scoreMonacoEditor(editor)
        };
      })
      .sort(function (left, right) {
        return right.score - left.score;
      })
      .map(function (entry) {
        return entry.editor;
      });
  }

  function scoreMonacoEditor(editor) {
    if (!editor) {
      return -1000;
    }

    var score = 0;
    var model = typeof editor.getModel === "function" ? editor.getModel() : null;

    if (typeof editor.hasTextFocus === "function" && editor.hasTextFocus()) {
      score += 240;
    }

    if (typeof editor.hasWidgetFocus === "function" && editor.hasWidgetFocus()) {
      score += 80;
    }

    var domNode = typeof editor.getDomNode === "function" ? editor.getDomNode() : null;

    if (domNode && isVisibleElement(domNode)) {
      score += 220;
    }

    if (domNode && /\bmonaco-editor\b/.test(domNode.className || "")) {
      score += 40;
    }

    score += scoreModel(model);
    return score;
  }

  function replaceMonacoEditorValue(editor, code) {
    if (!editor) {
      return false;
    }

    var model = typeof editor.getModel === "function" ? editor.getModel() : null;

    if (!model) {
      return false;
    }

    if (typeof editor.setValue === "function") {
      editor.setValue(code);
    } else if (!replaceMonacoModelValue(model, code)) {
      return false;
    }

    if (typeof editor.focus === "function") {
      editor.focus();
    }

    var value = typeof editor.getValue === "function" ? editor.getValue() : model.getValue();
    return areEquivalentCodeTexts(value, code);
  }

  function replaceMonacoModelValue(model, code) {
    if (!model || typeof model.setValue !== "function") {
      return false;
    }

    model.setValue(code);
    return areEquivalentCodeTexts(typeof model.getValue === "function" ? model.getValue() : "", code);
  }

  function areEquivalentCodeTexts(left, right) {
    return normalizeCodeText(left) === normalizeCodeText(right);
  }

  function normalizeCodeText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "");
  }

  function chooseLeetCodeModel(models) {
    var best = null;
    var bestScore = -Infinity;

    for (var index = 0; index < models.length; index += 1) {
      var model = models[index];
      var score = scoreModel(model);

      if (score > bestScore) {
        best = model;
        bestScore = score;
      }
    }

    return bestScore > -100 ? best : null;
  }

  function scoreModel(model) {
    if (!model || typeof model.getValue !== "function") {
      return -1000;
    }

    var languageId = typeof model.getLanguageId === "function" ? String(model.getLanguageId() || "").toLowerCase() : "";
    var uri = model.uri ? String(model.uri).toLowerCase() : "";
    var value = String(model.getValue() || "");
    var score = 0;

    if (isCodeLanguage(languageId)) {
      score += 120;
    }

    if (/leetcode|solution|submission|main|code|editor/.test(uri)) {
      score += 80;
    }

    if (/\b(class\s+Solution|def\s+\w+|function\s+\w+|public\s+class|impl\s+Solution|func\s+\w+)/.test(value)) {
      score += 60;
    }

    if (value.length > 0 && value.length < 20000) {
      score += 20;
    }

    if (/\.d\.ts|typescript\/lib|node_modules|monaco|json|schema|readme|markdown/.test(uri)) {
      score -= 300;
    }

    if (/json|markdown|plaintext|text|yaml|xml|html|css/.test(languageId)) {
      score -= 100;
    }

    if (value.length > 50000) {
      score -= 200;
    }

    return score;
  }

  function isCodeLanguage(languageId) {
    return {
      c: true,
      cpp: true,
      csharp: true,
      dart: true,
      erlang: true,
      go: true,
      golang: true,
      java: true,
      javascript: true,
      kotlin: true,
      mysql: true,
      php: true,
      python: true,
      python3: true,
      racket: true,
      ruby: true,
      rust: true,
      scala: true,
      swift: true,
      typescript: true
    }[languageId];
  }

  function insertWithCodeMirror(code) {
    var targets = Array.prototype.slice.call(document.querySelectorAll([
      ".cm-editor .cm-content[contenteditable='true']",
      ".cm-content[contenteditable='true']",
      "[role='textbox'][contenteditable='true']"
    ].join(","))).filter(isVisibleElement);
    var target = targets[targets.length - 1];

    if (!target) {
      return false;
    }

    target.focus();
    selectEditableContents(target);
    if (!code) {
      return document.execCommand("delete", false, null);
    }
    return document.execCommand("insertText", false, code);
  }

  function selectEditableContents(target) {
    var selection = window.getSelection && window.getSelection();

    if (!selection || !document.createRange) {
      return;
    }

    var range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertWithEditorDom(code) {
    var editor = findVisibleEditor();

    if (!editor) {
      return false;
    }

    var target = editor.querySelector("textarea.inputarea") ||
      editor.querySelector("textarea") ||
      editor.querySelector(".cm-content[contenteditable='true']") ||
      editor.querySelector("[contenteditable='true']") ||
      editor;

    if (!target) {
      return false;
    }

    if (isMonacoEditorTarget(editor) || isMonacoEditorTarget(target)) {
      return false;
    }

    target.focus();

    if ("value" in target) {
      target.value = code;
      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: code,
        inputType: "insertText"
      }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    selectEditableContents(target);
    if (!code) {
      return document.execCommand("delete", false, null);
    }
    return document.execCommand("insertText", false, code);
  }

  function isMonacoEditorTarget(node) {
    return Boolean(node && node.closest && node.closest(".monaco-editor, [class*='monaco']"));
  }

  function findVisibleEditor() {
    var selectors = [
      ".monaco-editor",
      ".cm-editor",
      "[data-track-load*='code_editor'] .monaco-editor",
      "[data-track-load*='code_editor'] .cm-editor",
      "[class*='monaco']",
      ".CodeMirror",
      ".cm-content[contenteditable='true']",
      "[contenteditable='true']"
    ];

    for (var index = 0; index < selectors.length; index += 1) {
      var nodes = Array.prototype.slice.call(document.querySelectorAll(selectors[index]))
        .filter(isVisibleElement);

      if (nodes.length > 0) {
        return nodes[nodes.length - 1];
      }
    }

    return null;
  }

  function isVisibleElement(node) {
    if (!node || !node.getBoundingClientRect) {
      return false;
    }

    var rect = node.getBoundingClientRect();
    var style = window.getComputedStyle(node);

    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  }
}

async function captureLeetCodeCodeSnapshotInMainWorld() {
  try {
    var monacoSnapshot = await captureMonacoSnapshot();

    if (monacoSnapshot) {
      return monacoSnapshot;
    }

    var domSnapshot = captureDomSnapshot();

    if (domSnapshot) {
      return domSnapshot;
    }

    throw new Error("Could not find a visible LeetCode editor.");
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }

  async function captureMonacoSnapshot() {
    var monaco = await resolveMonaco();

    if (!monaco || !monaco.editor || typeof monaco.editor.getModels !== "function") {
      return null;
    }

    var editors = getRankedMonacoEditors(monaco);

    for (var index = 0; index < editors.length; index += 1) {
      var editor = editors[index];
      var model = typeof editor.getModel === "function" ? editor.getModel() : null;
      var snapshot = captureMonacoModelSnapshot(model, "monaco");

      if (snapshot) {
        return snapshot;
      }
    }

    return captureMonacoModelSnapshot(chooseLeetCodeModel(monaco.editor.getModels()), "monaco-model");
  }

  function captureMonacoModelSnapshot(model, method) {
    if (!model || typeof model.getValue !== "function") {
      return null;
    }

    return {
      ok: true,
      method,
      text: normalizeCodeText(model.getValue()),
      languageId: typeof model.getLanguageId === "function" ? String(model.getLanguageId() || "") : ""
    };
  }

  function resolveMonaco() {
    if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getModels === "function") {
      return Promise.resolve(window.monaco);
    }

    if (typeof window.require !== "function") {
      return Promise.resolve(null);
    }

    return new Promise(function (resolve) {
      var finished = false;
      var timeoutId = setTimeout(function () {
        finish(null);
      }, 800);

      function finish(value) {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeoutId);
        resolve(value);
      }

      try {
        var direct = window.require("vs/editor/editor.main");

        if (window.monaco && window.monaco.editor) {
          finish(window.monaco);
          return;
        }

        if (direct && direct.editor) {
          finish(direct);
          return;
        }
      } catch {
        // Fall through to AMD async require.
      }

      try {
        window.require(["vs/editor/editor.main"], function () {
          finish(window.monaco || null);
        });
      } catch {
        finish(null);
      }
    });
  }

  function getMonacoEditors(monaco) {
    var editors = [];

    if (typeof monaco.editor.getEditors === "function") {
      editors = monaco.editor.getEditors();
    } else if (Array.isArray(monaco.editor._editors)) {
      editors = monaco.editor._editors;
    }

    return editors.filter(Boolean);
  }

  function getRankedMonacoEditors(monaco) {
    return getMonacoEditors(monaco)
      .map(function (editor) {
        return {
          editor: editor,
          score: scoreMonacoEditor(editor)
        };
      })
      .sort(function (left, right) {
        return right.score - left.score;
      })
      .map(function (entry) {
        return entry.editor;
      });
  }

  function scoreMonacoEditor(editor) {
    if (!editor) {
      return -1000;
    }

    var score = 0;
    var model = typeof editor.getModel === "function" ? editor.getModel() : null;
    var domNode = typeof editor.getDomNode === "function" ? editor.getDomNode() : null;

    if (typeof editor.hasTextFocus === "function" && editor.hasTextFocus()) {
      score += 240;
    }

    if (typeof editor.hasWidgetFocus === "function" && editor.hasWidgetFocus()) {
      score += 80;
    }

    if (domNode && isVisibleElement(domNode)) {
      score += 220;
    }

    score += scoreModel(model);
    return score;
  }

  function chooseLeetCodeModel(models) {
    var best = null;
    var bestScore = -Infinity;

    for (var index = 0; index < models.length; index += 1) {
      var model = models[index];
      var score = scoreModel(model);

      if (score > bestScore) {
        best = model;
        bestScore = score;
      }
    }

    return bestScore > -100 ? best : null;
  }

  function scoreModel(model) {
    if (!model || typeof model.getValue !== "function") {
      return -1000;
    }

    var languageId = typeof model.getLanguageId === "function" ? String(model.getLanguageId() || "").toLowerCase() : "";
    var uri = model.uri ? String(model.uri).toLowerCase() : "";
    var value = String(model.getValue() || "");
    var score = 0;

    if (isCodeLanguage(languageId)) {
      score += 120;
    }

    if (/leetcode|solution|submission|main|code|editor/.test(uri)) {
      score += 80;
    }

    if (/\b(class\s+Solution|def\s+\w+|function\s+\w+|public\s+class|impl\s+Solution|func\s+\w+)/.test(value)) {
      score += 60;
    }

    if (value.length > 0 && value.length < 20000) {
      score += 20;
    }

    if (/\.d\.ts|typescript\/lib|node_modules|monaco|json|schema|readme|markdown/.test(uri)) {
      score -= 300;
    }

    if (/json|markdown|plaintext|text|yaml|xml|html|css/.test(languageId)) {
      score -= 100;
    }

    if (value.length > 50000) {
      score -= 200;
    }

    return score;
  }

  function isCodeLanguage(languageId) {
    return {
      c: true,
      cpp: true,
      csharp: true,
      dart: true,
      erlang: true,
      go: true,
      golang: true,
      java: true,
      javascript: true,
      kotlin: true,
      mysql: true,
      php: true,
      python: true,
      python3: true,
      racket: true,
      ruby: true,
      rust: true,
      scala: true,
      swift: true,
      typescript: true
    }[languageId];
  }

  function captureDomSnapshot() {
    var editor = findVisibleEditor();

    if (!editor) {
      return null;
    }

    var target = editor.querySelector("textarea.inputarea") ||
      editor.querySelector("textarea") ||
      editor.querySelector(".cm-content[contenteditable='true']") ||
      editor.querySelector("[contenteditable='true']") ||
      editor;

    if (!target || isMonacoEditorTarget(editor) || isMonacoEditorTarget(target)) {
      return null;
    }

    if ("value" in target) {
      var inputText = normalizeCodeText(target.value);
      return {
        ok: true,
        method: "dom",
        text: inputText,
        languageId: detectLanguageIdFromCode(inputText)
      };
    }

    var contentText = normalizeCodeText(target.innerText || target.textContent || "");
    return {
      ok: true,
      method: "dom",
      text: contentText,
      languageId: detectLanguageIdFromCode(contentText)
    };
  }

  function detectLanguageIdFromCode(code) {
    var source = String(code || "");
    var lower = source.toLowerCase();

    if (lower.indexOf("c++") >= 0 ||
      lower.indexOf("cpp") >= 0 ||
      source.indexOf("#include") >= 0 ||
      /\bstd::\w+/.test(source) ||
      /\b(?:vector|string|unordered_map|unordered_set|map|set|queue|stack|priority_queue|pair)\s*</.test(source) ||
      /\b(?:ListNode|TreeNode)\s*\*/.test(source) ||
      /\bnullptr\b/.test(source) ||
      /^\s*class\s+Solution\s*\{[\s\S]*?\b(?:public|private|protected)\s*:/m.test(source)) {
      return "cpp";
    }

    if (/\bpublic\s+class\b/.test(source) ||
      /System\.out\.println/.test(source) ||
      /import\s+java\./.test(source) ||
      /^\s*class\s+Solution\s*\{[\s\S]*?\bpublic\s+(?:int|long|boolean|double|String|List<|TreeNode|ListNode|void)\b/m.test(source)) {
      return "java";
    }

    if (/^\s*class\s+\w+\s*:/m.test(source) || /^\s*def\s+\w+\s*\(/m.test(source)) {
      return "python";
    }

    if (/\bfunction\b|\bconst\b|\blet\b|\bvar\b|=>/.test(source)) {
      return "javascript";
    }

    return "";
  }

  function isMonacoEditorTarget(node) {
    return Boolean(node && node.closest && node.closest(".monaco-editor, [class*='monaco']"));
  }

  function findVisibleEditor() {
    var selectors = [
      ".cm-editor",
      "[data-track-load*='code_editor'] .cm-editor",
      ".CodeMirror",
      ".cm-content[contenteditable='true']",
      "[contenteditable='true']",
      "textarea"
    ];

    for (var index = 0; index < selectors.length; index += 1) {
      var nodes = Array.prototype.slice.call(document.querySelectorAll(selectors[index]))
        .filter(isVisibleElement);

      if (nodes.length > 0) {
        return nodes[nodes.length - 1];
      }
    }

    return null;
  }

  function isVisibleElement(node) {
    if (!node || !node.getBoundingClientRect) {
      return false;
    }

    var rect = node.getBoundingClientRect();
    var style = window.getComputedStyle(node);

    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  }

  function normalizeCodeText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "");
  }
}

async function testProblemSource() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const source = settings.problemSource || "auto";

  if (source === "custom") {
    return fetchProblemContextV3({
      pageUrl: "chrome-extension://test",
      pageTitle: "连接测试",
      pageText: "这是一段用于测试题目服务器连接的页面文本。",
      selection: "",
      code: "",
      language: "auto",
      test: true
    }, { requireServer: true });
  }

  if (source === "page") {
    return {
      fromServer: false,
      source: "页面内容",
      problem: "当前配置为只读取页面内容，不会连接外部题目服务器。"
    };
  }

  if (source === "leetcode") {
    return fetchProblemContextV3({
      pageUrl: "https://leetcode.cn/problems/two-sum/description/",
      pageTitle: "杩炴帴娴嬭瘯",
      pageText: "",
      selection: "",
      code: "",
      language: "auto",
      platform: "leetcode",
      problemId: "two-sum",
      test: true
    }, { requireServer: true });
  }

  return fetchLuoguProblem("P1001", normalizeTimeout(settings.timeoutSeconds));
}

async function fetchProblemContext(payload, options = {}) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const endpoint = String(settings.problemServerEndpoint || "").trim();
  const token = String(settings.problemServerToken || "").trim();
  const source = settings.problemSource || "auto";
  const timeoutSeconds = normalizeTimeout(settings.timeoutSeconds);
  const luoguProblemId = payload.problemId || getLuoguProblemId(payload.pageUrl);

  if ((source === "luogu" || (source === "auto" && luoguProblemId)) && luoguProblemId) {
    try {
      return await fetchLuoguProblem(luoguProblemId, timeoutSeconds);
    } catch (error) {
      if (source === "luogu" || options.requireServer) {
        throw error;
      }
    }
  }

  if (source === "luogu" && !luoguProblemId) {
    throw new Error("当前页面不是洛谷题目页，无法识别题号。请打开 https://www.luogu.com.cn/problem/P1001 这类题目页。");
  }

  if (source === "page") {
    return {
      fromServer: false,
      source: "页面内容",
      problem: buildLocalProblem(payload)
    };
  }

  if (endpoint && (source === "custom" || source === "auto")) {
    return fetchCustomProblemServer(endpoint, token, timeoutSeconds, payload);
  }

  if (options.requireServer) {
    throw new Error("题目服务器地址为空。请先在插件弹窗中填写服务器地址，或把题目来源改为洛谷。");
  }

  return {
    fromServer: false,
    source: payload.platform === "luogu" ? "洛谷页面内容" : "页面内容",
    problem: buildLocalProblem(payload)
  };
}

const __disabled_fetchProblemContextV2 = String.raw`async function fetchProblemContextV2(payload, options = {}) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const endpoint = String(settings.problemServerEndpoint || "").trim();
  const token = String(settings.problemServerToken || "").trim();
  const source = settings.problemSource || "auto";
  const timeoutSeconds = normalizeTimeout(settings.timeoutSeconds);
  const platform = detectProblemPlatform(payload.pageUrl, payload.platform);
  const luoguProblemId = platform === "luogu"
    ? String(payload.problemId || "").trim() || getLuoguProblemId(payload.pageUrl)
    : getLuoguProblemId(payload.pageUrl);
  const leetcodeProblemId = platform === "leetcode"
    ? String(payload.problemId || "").trim() || getLeetCodeProblemSlug(payload.pageUrl)
    : getLeetCodeProblemSlug(payload.pageUrl);
  const normalizedPayload = {
    ...payload,
    platform,
    problemId: platform === "luogu"
      ? luoguProblemId
      : platform === "leetcode"
        ? leetcodeProblemId
        : String(payload.problemId || "").trim()
  };

  if ((source === "luogu" || (source === "auto" && luoguProblemId)) && luoguProblemId) {
    try {
      return await fetchLuoguProblem(luoguProblemId, timeoutSeconds);
    } catch (error) {
      if (source === "luogu" || options.requireServer) {
        throw error;
      }
    }
  }

  if ((source === "leetcode" || (source === "auto" && leetcodeProblemId)) && leetcodeProblemId) {
    try {
      return await fetchLeetCodeProblem(leetcodeProblemId, normalizedPayload.pageUrl, timeoutSeconds);
    } catch (error) {
      if (source === "leetcode" || options.requireServer) {
        throw error;
      }
    }
  }

  if (source === "luogu" && !luoguProblemId) {
    throw new Error("褰撳墠椤甸潰涓嶆槸娲涜胺棰樼洰椤碉紝鏃犳硶璇嗗埆棰樺彿銆傝鎵撳紑 https://www.luogu.com.cn/problem/P1001 杩欑被棰樼洰椤点€?");
  }

  if (source === "leetcode" && !leetcodeProblemId) {
    throw new Error("褰撳墠椤甸潰涓嶆槸鍔涘彛棰樼洰椤碉紝鏃犳硶璇嗗埆棰樼洰鏍囪瘑銆傝鎵撳紑 https://leetcode.cn/problems/two-sum/description/ 杩欑被鍔涘彛棰樼洰椤点€?");
  }

  if (source === "page") {
    return {
      fromServer: false,
      source: "椤甸潰鍐呭",
      problem: buildLocalProblem(normalizedPayload)
    };
  }

  if (endpoint && (source === "custom" || source === "auto")) {
    return fetchCustomProblemServer(endpoint, token, timeoutSeconds, normalizedPayload);
  }

  if (options.requireServer) {
    throw new Error("棰樼洰鏈嶅姟鍣ㄥ湴鍧€涓虹┖銆傝鍏堝湪鎻掍欢寮圭獥涓～鍐欐湇鍔″櫒鍦板潃锛屾垨鎶婇鐩潵婧愭敼涓烘礇璋锋垨鍔涘彛銆?");
  }

  return {
    fromServer: false,
    source: getPlatformPageSource(platform) || "椤甸潰鍐呭",
    problem: buildLocalProblem(normalizedPayload)
  };
}`;

async function fetchProblemContextV3(payload, options = {}) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const endpoint = String(settings.problemServerEndpoint || "").trim();
  const token = String(settings.problemServerToken || "").trim();
  const source = settings.problemSource || "auto";
  const timeoutSeconds = normalizeTimeout(settings.timeoutSeconds);
  const platform = detectProblemPlatform(payload.pageUrl, payload.platform);
  const luoguProblemId = platform === "luogu"
    ? String(payload.problemId || "").trim() || getLuoguProblemId(payload.pageUrl)
    : getLuoguProblemId(payload.pageUrl);
  const leetcodeProblemId = platform === "leetcode"
    ? String(payload.problemId || "").trim() || getLeetCodeProblemSlug(payload.pageUrl)
    : getLeetCodeProblemSlug(payload.pageUrl);
  const normalizedPayload = {
    ...payload,
    platform,
    problemId: platform === "luogu"
      ? luoguProblemId
      : platform === "leetcode"
        ? leetcodeProblemId
        : String(payload.problemId || "").trim()
  };

  if ((source === "luogu" || (source === "auto" && luoguProblemId)) && luoguProblemId) {
    try {
      return await fetchLuoguProblem(luoguProblemId, timeoutSeconds);
    } catch (error) {
      if (source === "luogu" || options.requireServer) {
        throw error;
      }
    }
  }

  if ((source === "leetcode" || (source === "auto" && leetcodeProblemId)) && leetcodeProblemId) {
    try {
      return await fetchLeetCodeProblemV2(leetcodeProblemId, normalizedPayload.pageUrl, timeoutSeconds);
    } catch (error) {
      if (source === "leetcode" || options.requireServer) {
        throw error;
      }
    }
  }

  if (source === "luogu" && !luoguProblemId) {
    throw new Error("Current page is not a Luogu problem page. Open a URL like https://www.luogu.com.cn/problem/P1001 .");
  }

  if (source === "leetcode" && !leetcodeProblemId) {
    throw new Error("Current page is not a LeetCode problem page. Open a URL like https://leetcode.cn/problems/two-sum/description/ .");
  }

  if (source === "page") {
    return {
      fromServer: false,
      source: "Page Content",
      problem: buildLocalProblem(normalizedPayload)
    };
  }

  if (endpoint && (source === "custom" || source === "auto")) {
    return fetchCustomProblemServer(endpoint, token, timeoutSeconds, normalizedPayload);
  }

  if (options.requireServer) {
    throw new Error("Problem server endpoint is empty. Fill in a custom server endpoint or switch the source to Luogu or LeetCode.");
  }

  return {
    fromServer: false,
    source: getPlatformPageSourceV2(platform) || "Page Content",
    problem: buildLocalProblem(normalizedPayload)
  };
}

async function fetchCustomProblemServer(endpoint, token, timeoutSeconds, payload) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pageUrl: payload.pageUrl || "",
      pageTitle: payload.pageTitle || "",
      pageText: compactText(payload.pageText, PROBLEM_TEXT_LIMIT),
      selection: compactText(payload.selection, 4000),
      code: compactText(payload.code, 12000),
      language: payload.language || "auto",
      platform: payload.platform || "",
      problemId: payload.problemId || "",
      test: Boolean(payload.test)
    })
  }, timeoutSeconds, "题目服务器请求");

  const rawText = await response.text();
  const data = safeParseJson(rawText);

  if (looksLikeHtml(rawText)) {
    throw new Error("题目服务器返回的是 HTML 页面，不是 JSON 或纯文本题目内容。");
  }

  if (!response.ok) {
    const message = getErrorMessage(data, rawText) || "题目服务器请求失败，状态码：" + response.status;
    throw new Error(message);
  }

  const problem = normalizeProblemFromServer(data, rawText);

  if (!problem) {
    throw new Error("题目服务器没有返回题目内容。可返回 JSON 字段 problem、question、description、content、context 或纯文本。");
  }

  return {
    fromServer: true,
    source: "自定义服务器",
    problem,
    data
  };
}

async function fetchLuoguProblem(problemId, timeoutSeconds) {
  const cleanProblemId = String(problemId || "").trim();

  if (!cleanProblemId) {
    throw new Error("洛谷题号为空。");
  }

  const url = "https://www.luogu.com.cn/problem/" + encodeURIComponent(cleanProblemId);
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }, timeoutSeconds, "洛谷题目请求");

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error("洛谷题目请求失败，状态码：" + response.status + "，题号：" + cleanProblemId);
  }

  const injection = extractLuoguInjection(rawText);
  const fromInjection = injection ? buildLuoguProblemFromInjection(injection, cleanProblemId, url) : "";
  const fromHtml = fromInjection || extractLuoguProblemFromHtml(rawText, cleanProblemId, url);

  if (!fromHtml) {
    throw new Error("已连接洛谷，但没有解析到题面内容。洛谷页面结构可能变化，请临时切换为“页面内容”来源。");
  }

  return {
    fromServer: true,
    source: "洛谷服务器",
    problem: fromHtml,
    data: {
      platform: "luogu",
      problemId: cleanProblemId,
      url
    }
  };
}

const __disabled_fetchLeetCodeProblem = String.raw`async function fetchLeetCodeProblem(problemSlug, pageUrl, timeoutSeconds) {
  const cleanProblemSlug = String(problemSlug || "").trim();

  if (!cleanProblemSlug) {
    throw new Error("鍔涘彛棰樼洰鏍囪瘑涓虹┖銆?");
  }

  const url = buildLeetCodeProblemUrl(cleanProblemSlug, pageUrl);
  let firstError = null;

  try {
    const question = await fetchLeetCodeQuestion(cleanProblemSlug, url, timeoutSeconds);
    const problem = buildLeetCodeProblemFromQuestion(question, cleanProblemSlug, url);

    if (problem) {
      return {
        fromServer: true,
        source: getLeetCodeSourceName(url),
        problem,
        data: {
          platform: "leetcode",
          problemId: cleanProblemSlug,
          url
        }
      };
    }
  } catch (error) {
    firstError = error;
  }

  try {
    const problem = await fetchLeetCodeProblemFromHtml(cleanProblemSlug, url, timeoutSeconds);

    return {
      fromServer: true,
      source: getLeetCodeSourceName(url),
      problem,
      data: {
        platform: "leetcode",
        problemId: cleanProblemSlug,
        url
      }
    };
  } catch (error) {
    if (firstError) {
      throw new Error(firstError.message + "锛汬TML 鍥為€€涔熷け璐ワ細" + error.message);
    }

    throw error;
  }
}

async function fetchLeetCodeQuestion(problemSlug, url, timeoutSeconds) {
  const response = await fetchWithTimeout(getLeetCodeSiteRoot(url) + "/graphql/", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: url
    },
    body: JSON.stringify({
      operationName: "questionData",
      query: LEETCODE_QUESTION_QUERY,
      variables: {
        titleSlug: problemSlug
      }
    })
  }, timeoutSeconds, "鍔涘彛棰樼洰璇锋眰");

  const rawText = await response.text();
  const data = safeParseJson(rawText);

  if (looksLikeHtml(rawText)) {
    throw new Error("鍔涘彛棰樼洰鏈嶅姟杩斿洖鐨勬槸 HTML 椤甸潰锛屼笉鏄鏈熺殑 GraphQL JSON銆?");
  }

  if (!response.ok) {
    const message = getErrorMessage(data, rawText) || "鍔涘彛棰樼洰璇锋眰澶辫触锛岀姸鎬佺爜锛? + response.status;
    throw new Error(message);
  }

  const question = data && data.data && data.data.question;

  if (!question) {
    throw new Error("鍔涘彛娌℃湁杩斿洖棰樼洰鏁版嵁銆?");
  }

  return question;
}

async function fetchLeetCodeProblemFromHtml(problemSlug, url, timeoutSeconds) {
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }, timeoutSeconds, "鍔涘彛棰樼洰璇锋眰");

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error("鍔涘彛棰樼洰璇锋眰澶辫触锛岀姸鎬佺爜锛? + response.status + "锛岄鐩爣璇嗭細" + problemSlug);
  }

  const problem = extractLeetCodeProblemFromHtml(rawText, problemSlug, url);

  if (!problem) {
    throw new Error("宸茶繛鎺ュ姏鎵ｏ紝浣嗘病鏈夎В鏋愬埌棰橀潰鍐呭銆傚姏鎵ｉ〉闈㈢粨鏋勫彲鑳藉彉鍖栵紝璇蜂复鏃跺垏鎹负鈥滈〉闈㈠唴瀹光€濇潵婧愩€?");
  }

  return problem;
}`;

async function fetchLeetCodeProblemV2(problemSlug, pageUrl, timeoutSeconds) {
  const cleanProblemSlug = String(problemSlug || "").trim();

  if (!cleanProblemSlug) {
    throw new Error("LeetCode problem slug is empty.");
  }

  const url = buildLeetCodeProblemUrlV2(cleanProblemSlug, pageUrl);
  let firstError = null;

  try {
    const question = await fetchLeetCodeQuestionV2(cleanProblemSlug, url, timeoutSeconds);
    const problem = buildLeetCodeProblemFromQuestionV2(question, cleanProblemSlug, url);

    if (problem) {
      return {
        fromServer: true,
        source: getLeetCodeSourceNameV2(url),
        problem,
        data: {
          platform: "leetcode",
          problemId: cleanProblemSlug,
          url
        }
      };
    }
  } catch (error) {
    firstError = error;
  }

  try {
    const problem = await fetchLeetCodeProblemFromHtmlV2(cleanProblemSlug, url, timeoutSeconds);

    return {
      fromServer: true,
      source: getLeetCodeSourceNameV2(url),
      problem,
      data: {
        platform: "leetcode",
        problemId: cleanProblemSlug,
        url
      }
    };
  } catch (error) {
    if (firstError) {
      throw new Error(firstError.message + " HTML fallback failed: " + error.message);
    }

    throw error;
  }
}

async function fetchLeetCodeQuestionV2(problemSlug, url, timeoutSeconds) {
  const response = await fetchWithTimeout(getLeetCodeSiteRootV2(url) + "/graphql/", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: url
    },
    body: JSON.stringify({
      operationName: "questionData",
      query: LEETCODE_QUESTION_QUERY,
      variables: {
        titleSlug: problemSlug
      }
    })
  }, timeoutSeconds, "LeetCode request");

  const rawText = await response.text();
  const data = safeParseJson(rawText);

  if (looksLikeHtml(rawText)) {
    throw new Error("LeetCode returned HTML instead of GraphQL JSON.");
  }

  if (!response.ok) {
    const message = getErrorMessage(data, rawText) || ("LeetCode request failed with status " + response.status);
    throw new Error(message);
  }

  const question = data && data.data && data.data.question;

  if (!question) {
    throw new Error("LeetCode response did not include question data.");
  }

  return question;
}

async function fetchLeetCodeProblemFromHtmlV2(problemSlug, url, timeoutSeconds) {
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }, timeoutSeconds, "LeetCode request");

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error("LeetCode request failed with status " + response.status + " for slug " + problemSlug + ".");
  }

  const problem = extractLeetCodeProblemFromHtmlV2(rawText, problemSlug, url);

  if (!problem) {
    throw new Error("Connected to LeetCode but could not parse the problem statement.");
  }

  return problem;
}

async function fetchWithTimeout(url, init, timeoutSeconds, label, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  let abortedByCaller = false;
  const abortFromCaller = () => {
    abortedByCaller = true;
    controller.abort();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      abortFromCaller();
    } else {
      options.signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      if (abortedByCaller) {
        throw new Error(options.abortMessage || (label + "已停止。"));
      }

      throw new Error(label + "超过 " + timeoutSeconds + " 秒。请检查服务器响应速度或在插件弹窗中调大超时时间。");
    }

    throw new Error(label + "无法连接。请检查地址、网络、代理、本地服务是否启动。当前地址：" + url);
  } finally {
    if (options.signal) {
      options.signal.removeEventListener("abort", abortFromCaller);
    }
    clearTimeout(timeoutId);
  }
}

function getLuoguProblemId(url) {
  const match = String(url || "").match(/https?:\/\/(?:www\.)?luogu\.com\.cn\/problem\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

const __disabled_leetcodeHelpers = String.raw`function getLeetCodeProblemSlug(url) {
  const match = String(url || "").match(/https?:\/\/(?:www\.)?(?:leetcode\.cn|leetcode\.com|leetcode-cn\.com)\/problems\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function detectProblemPlatform(url, platformHint) {
  const hint = String(platformHint || "").trim().toLowerCase();

  if (hint === "luogu" || hint === "leetcode") {
    return hint;
  }

  if (getLuoguProblemId(url)) {
    return "luogu";
  }

  if (getLeetCodeProblemSlug(url)) {
    return "leetcode";
  }

  return "";
}

function getPlatformPageSource(platform) {
  if (platform === "luogu") {
    return "娲涜胺椤甸潰鍐呭";
  }

  if (platform === "leetcode") {
    return "鍔涘彛椤甸潰鍐呭";
  }

  return "";
}

function getLeetCodeSiteRoot(url) {
  const match = String(url || "").match(/^https?:\/\/(?:www\.)?(leetcode\.cn|leetcode\.com|leetcode-cn\.com)/i);

  if (!match) {
    return "https://leetcode.cn";
  }

  const host = match[1].toLowerCase() === "leetcode-cn.com" ? "leetcode.cn" : match[1].toLowerCase();
  return "https://" + host;
}

function buildLeetCodeProblemUrl(problemSlug, pageUrl) {
  return getLeetCodeSiteRoot(pageUrl) + "/problems/" + encodeURIComponent(problemSlug) + "/description/";
}

function getLeetCodeDisplayName(url) {
  return /leetcode\.com/i.test(getLeetCodeSiteRoot(url)) ? "LeetCode" : "鍔涘彛";
}

function getLeetCodeSourceName(url) {
  return getLeetCodeDisplayName(url) + "鏈嶅姟鍣?";
}`;

function getLeetCodeProblemSlug(url) {
  const match = String(url || "").match(/https?:\/\/(?:www\.)?(?:leetcode\.cn|leetcode\.com|leetcode-cn\.com)\/problems\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function detectProblemPlatform(url, platformHint) {
  const hint = String(platformHint || "").trim().toLowerCase();

  if (hint === "luogu" || hint === "leetcode") {
    return hint;
  }

  if (getLuoguProblemId(url)) {
    return "luogu";
  }

  if (getLeetCodeProblemSlug(url)) {
    return "leetcode";
  }

  return "";
}

function getPlatformPageSourceV2(platform) {
  if (platform === "luogu") {
    return "Luogu Page";
  }

  if (platform === "leetcode") {
    return "LeetCode Page";
  }

  return "";
}

function getLeetCodeSiteRootV2(url) {
  const match = String(url || "").match(/^https?:\/\/(?:www\.)?(leetcode\.cn|leetcode\.com|leetcode-cn\.com)/i);

  if (!match) {
    return "https://leetcode.cn";
  }

  const host = match[1].toLowerCase() === "leetcode-cn.com" ? "leetcode.cn" : match[1].toLowerCase();
  return "https://" + host;
}

function buildLeetCodeProblemUrlV2(problemSlug, pageUrl) {
  return getLeetCodeSiteRootV2(pageUrl) + "/problems/" + encodeURIComponent(problemSlug) + "/description/";
}

function getLeetCodeDisplayNameV2(url) {
  return /leetcode\.com/i.test(getLeetCodeSiteRootV2(url)) ? "LeetCode" : "LeetCode CN";
}

function getLeetCodeSourceNameV2(url) {
  return getLeetCodeDisplayNameV2(url) + " Server";
}

function extractLuoguInjection(html) {
  const encodedMatch = String(html || "").match(/_feInjection\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/);

  if (encodedMatch) {
    try {
      return JSON.parse(decodeURIComponent(encodedMatch[1]));
    } catch {
      return null;
    }
  }

  const markerIndex = String(html || "").indexOf("_feInjection");

  if (markerIndex < 0) {
    return null;
  }

  const objectStart = html.indexOf("{", markerIndex);
  const objectText = extractBalancedJsonObject(html, objectStart);

  if (!objectText) {
    return null;
  }

  return safeParseJson(objectText);
}

function extractBalancedJsonObject(text, startIndex) {
  if (startIndex < 0) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function buildLuoguProblemFromInjection(injection, fallbackProblemId, url) {
  const problem = findLuoguProblemNode(injection);

  if (!problem) {
    return "";
  }

  const problemId = problem.pid || problem.problemId || fallbackProblemId;
  const title = problem.title || problem.name || "";
  const sections = [
    "来源：洛谷",
    "题号：" + problemId,
    title ? "标题：" + title : "",
    "地址：" + url,
    formatSection("题目背景", problem.background),
    formatSection("题目描述", problem.description || problem.content),
    formatSection("输入格式", problem.inputFormat),
    formatSection("输出格式", problem.outputFormat),
    formatSamples(getLuoguProblemSamples(problem)),
    formatSection("说明/提示", problem.hint),
    formatLimits(problem.limits || problem.limit)
  ];

  return finalizeLuoguProblemText(sections.filter(Boolean).join("\n\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
}

function findLuoguProblemNode(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) {
    return null;
  }

  if (
    (typeof value.pid === "string" || typeof value.problemId === "string" || typeof value.title === "string") &&
    (value.description || value.content || value.inputFormat || value.outputFormat || getLuoguProblemSamples(value).length)
  ) {
    return value;
  }

  const priorityKeys = ["currentData", "problem", "data", "result"];

  for (const key of priorityKeys) {
    const result = findLuoguProblemNode(value[key], depth + 1);

    if (result) {
      return result;
    }
  }

  for (const key of Object.keys(value)) {
    if (priorityKeys.includes(key)) {
      continue;
    }

    const result = findLuoguProblemNode(value[key], depth + 1);

    if (result) {
      return result;
    }
  }

  return null;
}

function formatSection(title, content) {
  const text = stringifyMarkdown(content);
  return text ? title + "：\n" + text : "";
}

function getLuoguProblemSamples(problem) {
  if (!problem || typeof problem !== "object") {
    return [];
  }

  const candidates = [
    problem.samples,
    problem.sampleCases,
    problem.sampleCase,
    problem.examples,
    problem.example,
    problem.testCases,
    problem.testCase,
    problem.cases
  ];

  for (const candidate of candidates) {
    const samples = normalizeLuoguSampleList(candidate);

    if (samples.length > 0) {
      return samples;
    }
  }

  return [];
}

function normalizeLuoguSampleList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    if (value.length >= 2 && !Array.isArray(value[0]) && typeof value[0] !== "object") {
      return [{ input: value[0], output: value[1] }];
    }

    return value
      .flatMap((item) => normalizeLuoguSampleList(item))
      .filter((sample) => sample.input || sample.output);
  }

  if (typeof value === "object") {
    const input = value.input ?? value.in ?? value.stdin ?? value.data ?? value.testInput ?? value.inputData ?? value[0];
    const output = value.output ?? value.out ?? value.stdout ?? value.answer ?? value.ans ?? value.expected ?? value.testOutput ?? value.outputData ?? value[1];

    if (typeof input !== "undefined" || typeof output !== "undefined") {
      return [{ input: input || "", output: output || "" }];
    }

    return Object.values(value)
      .flatMap((item) => normalizeLuoguSampleList(item))
      .filter((sample) => sample.input || sample.output);
  }

  return [];
}

function formatSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return "";
  }

  const lines = ["输入输出样例："];

  samples.forEach((sample, index) => {
    const input = stringifySampleText(sample.input || sample[0] || "");
    const output = stringifySampleText(sample.output || sample[1] || "");

    lines.push("", "输入 #" + (index + 1), input || "空", "输出 #" + (index + 1), output || "空");
  });

  return lines.join("\n");
}

function stringifySampleText(value) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(stringifySampleText).join("\n");
  }

  return normalizeMathText(decodeHtmlEntities(String(value)))
    .replace(/\r/g, "\n")
    .replace(/\$\$?/g, "")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\ldots/g, "...")
    .replace(/\\,/g, " ")
    .replace(/\t/g, "    ")
    .trim();
}

function formatLimits(limits) {
  if (!limits) {
    return "";
  }

  if (typeof limits === "string") {
    return "限制：\n" + limits;
  }

  try {
    return "限制：\n" + JSON.stringify(limits);
  } catch {
    return "";
  }
}

const __disabled_buildLeetCodeProblem = String.raw`function buildLeetCodeProblemFromQuestion(question, fallbackProblemSlug, url) {
  if (!question || typeof question !== "object") {
    return "";
  }

  const problemId = String(question.questionFrontendId || question.questionId || fallbackProblemSlug || "").trim();
  const title = String(question.translatedTitle || question.title || "").trim();
  const bodyHtml = question.translatedContent || question.content || "";
  const bodyText = sliceLeetCodeProblemText(htmlToText(bodyHtml), title, fallbackProblemSlug);
  const pieces = [
    "鏉ユ簮锛? + getLeetCodeDisplayName(url),
    problemId ? "棰樺彿锛? + problemId + (fallbackProblemSlug && fallbackProblemSlug !== problemId ? " (" + fallbackProblemSlug + ")" : "") : "",
    title ? "鏍囬锛? + title : "",
    "鍦板潃锛? + url,
    formatSection("棰樼洰鎻忚堪", bodyText),
    question.difficulty ? "闅惧害锛? + String(question.difficulty).trim() : "",
    formatLeetCodeTags(question.topicTags),
    formatLeetCodeHints(question.hints)
  ];

  return finalizeLeetCodeProblemText(pieces.filter(Boolean).join("\n\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
}

function formatLeetCodeTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "";
  }

  const items = tags
    .map((tag) => tag && (tag.translatedName || tag.name || ""))
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);

  return items.length ? "鏍囩锛? + items.join("銆? ") : "";
}

function formatLeetCodeHints(hints) {
  if (!Array.isArray(hints) || hints.length === 0) {
    return "";
  }

  const items = hints
    .map((hint, index) => {
      const text = cleanLuoguProblemText(htmlToText(hint));
      return text ? (index + 1) + ". " + text : "";
    })
    .filter(Boolean);

  return items.length ? formatSection("璇存槑/鎻愮ず", items.join("\n")) : "";
}

function finalizeLeetCodeProblemText(text) {
  return finalizeLuoguProblemText(text);
}

function sliceLeetCodeProblemText(text, title, problemSlug) {
  const value = String(text || "").trim();

  if (!value) {
    return "";
  }

  const normalizedTitle = String(title || "").trim();
  const normalizedSlug = String(problemSlug || "").replace(/-/g, " ").trim();
  const startMarkers = [
    normalizedTitle,
    "棰樼洰鎻忚堪",
    "Description",
    normalizedSlug,
    "绀轰緥 1",
    "Example 1",
    "缁欎綘",
    "You are given"
  ].filter(Boolean);
  const endMarkers = [
    "鐩稿叧鏍囩",
    "Related Topics",
    "鐩稿叧浼佷笟",
    "Companies",
    "鐩稿叧棰樼洰",
    "Similar Questions",
    "鎻愪氦璁板綍",
    "Submissions",
    "璁ㄨ",
    "Discussion",
    "棰樿В",
    "Solutions",
    "閫氳繃娆℃暟",
    "Accepted",
    "Runtime",
    "Memory"
  ];
  const starts = startMarkers
    .map((marker) => value.indexOf(marker))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  const ends = endMarkers
    .map((marker) => value.indexOf(marker, start + 1))
    .filter((index) => index > start);
  const end = ends.length ? Math.min(...ends) : value.length;

  return value.slice(start, end).trim().slice(0, PROBLEM_TEXT_LIMIT);
}`;

function buildLeetCodeProblemFromQuestionV2(question, fallbackProblemSlug, url) {
  if (!question || typeof question !== "object") {
    return "";
  }

  const problemId = String(question.questionFrontendId || question.questionId || fallbackProblemSlug || "").trim();
  const title = String(question.translatedTitle || question.title || "").trim();
  const bodyHtml = question.translatedContent || question.content || "";
  const bodyText = sliceLeetCodeProblemTextV2(htmlToText(bodyHtml), title, fallbackProblemSlug);
  const pieces = [
    "Source: " + getLeetCodeDisplayNameV2(url),
    problemId ? "Problem ID: " + problemId + (fallbackProblemSlug && fallbackProblemSlug !== problemId ? " (" + fallbackProblemSlug + ")" : "") : "",
    title ? "Title: " + title : "",
    "URL: " + url,
    formatSection("Description", bodyText),
    question.difficulty ? "Difficulty: " + String(question.difficulty).trim() : "",
    formatLeetCodeTagsV2(question.topicTags),
    formatLeetCodeHintsV2(question.hints)
  ];

  return finalizeLeetCodeProblemTextV2(pieces.filter(Boolean).join("\n\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
}

function formatLeetCodeTagsV2(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "";
  }

  const items = tags
    .map((tag) => tag && (tag.translatedName || tag.name || ""))
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);

  return items.length ? "Tags: " + items.join(", ") : "";
}

function formatLeetCodeHintsV2(hints) {
  if (!Array.isArray(hints) || hints.length === 0) {
    return "";
  }

  const items = hints
    .map((hint, index) => {
      const text = cleanLuoguProblemText(htmlToText(hint));
      return text ? (index + 1) + ". " + text : "";
    })
    .filter(Boolean);

  return items.length ? formatSection("Hints", items.join("\n")) : "";
}

function finalizeLeetCodeProblemTextV2(text) {
  return finalizeLuoguProblemText(text);
}

function sliceLeetCodeProblemTextV2(text, title, problemSlug) {
  const value = String(text || "").trim();

  if (!value) {
    return "";
  }

  const normalizedTitle = String(title || "").trim();
  const normalizedSlug = String(problemSlug || "").replace(/-/g, " ").trim();
  const startMarkers = [
    normalizedTitle,
    "Description",
    normalizedSlug,
    "Example 1",
    "You are given"
  ].filter(Boolean);
  const endMarkers = [
    "Related Topics",
    "Companies",
    "Similar Questions",
    "Submissions",
    "Discussion",
    "Solutions",
    "Accepted",
    "Runtime",
    "Memory"
  ];
  const starts = startMarkers
    .map((marker) => value.indexOf(marker))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  const ends = endMarkers
    .map((marker) => value.indexOf(marker, start + 1))
    .filter((index) => index > start);
  const end = ends.length ? Math.min(...ends) : value.length;

  return value.slice(start, end).trim().slice(0, PROBLEM_TEXT_LIMIT);
}

function stringifyMarkdown(value) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "string") {
    return cleanLuoguProblemText(decodeHtmlEntities(value));
  }

  if (Array.isArray(value)) {
    return value.map(stringifyMarkdown).filter(Boolean).join("\n");
  }

  return cleanLuoguProblemText(String(value));
}

const __disabled_extractLeetCodeProblemFromHtml = String.raw`function extractLeetCodeProblemFromHtml(html, problemSlug, url) {
  const title = decodeHtmlEntities((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    .replace(/\s*-\s*(?:LeetCode|鍔涘彛.*)$/i, "")
    .trim();
  const text = htmlToText(html);
  const body = sliceLeetCodeProblemText(text, title, problemSlug);

  if (!body) {
    return "";
  }

  return finalizeLeetCodeProblemText([
    "鏉ユ簮锛? + getLeetCodeDisplayName(url),
    problemSlug ? "棰樺彿锛? + problemSlug : "",
    title ? "鏍囬锛? + title : "",
    "鍦板潃锛? + url,
    formatSection("棰樼洰鎻忚堪", body)
  ].filter(Boolean).join("\n\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
}`;

function extractLeetCodeProblemFromHtmlV2(html, problemSlug, url) {
  const title = decodeHtmlEntities((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    .replace(/\s*-\s*(?:LeetCode|.*leetcode.*)$/i, "")
    .trim();
  const text = htmlToText(html);
  const body = sliceLeetCodeProblemTextV2(text, title, problemSlug);

  if (!body) {
    return "";
  }

  return finalizeLeetCodeProblemTextV2([
    "Source: " + getLeetCodeDisplayNameV2(url),
    problemSlug ? "Problem ID: " + problemSlug : "",
    title ? "Title: " + title : "",
    "URL: " + url,
    formatSection("Description", body)
  ].filter(Boolean).join("\n\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
}

function extractLuoguProblemFromHtml(html, problemId, url) {
  const title = decodeHtmlEntities((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    .replace(/\s*-\s*洛谷.*$/, "")
    .trim();
  const text = htmlToText(html);
  const anchors = ["题目描述", "题目背景", "输入格式", "输出格式"];
  const starts = anchors
    .map((anchor) => text.indexOf(anchor))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  const body = text.slice(start, start + PROBLEM_TEXT_LIMIT).trim();

  if (!body) {
    return "";
  }

  return finalizeLuoguProblemText([
    "来源：洛谷",
    "题号：" + problemId,
    title ? "标题：" + title : "",
    "地址：" + url,
    body
  ].filter(Boolean).join("\n\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
}

function htmlToText(html) {
  const text = decodeHtmlEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<button[\s\S]*?<\/button>/gi, "\n")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "\n")
    .replace(/<header[\s\S]*?<\/header>/gi, "\n")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "\n")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "\n")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "\n")
    .replace(/<[^>]*(?:id|class)=["'][^"']*(?:advert|advertisement|banner|sponsor|sponsored|promo|promotion|recommend|sidebar|comment|discuss|share|login|modal|popup|qrcode|wechat|weixin)[^"']*["'][\s\S]*?<\/[^>]+>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n"));

  return cleanLuoguProblemText(text);
}

function cleanLuoguProblemText(value) {
  const text = normalizeMathText(String(value || ""))
    .replace(/\r/g, "\n")
    .replace(/\$\$?/g, "")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\ldots/g, "...")
    .replace(/\\,/g, " ")
    .split("\n")
    .map((line) => line
      .replace(/^#{1,6}\s*/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\\([a-zA-Z]+)/g, "$1")
      .replace(/\t/g, "    ")
      .trim())
    .filter((line) => line && !isLuoguNoiseLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return removeEmptyLuoguHintSections(text);
}

function normalizeMathText(value) {
  return String(value || "")
    .replace(/([A-Za-z0-9)\]])_\{([^{}\n]+)\}/g, "$1_{$2}")
    .replace(/([A-Za-z0-9)\]])_([A-Za-z0-9]+)/g, "$1_$2")
    .replace(/([A-Za-z])\s*\{\s*([A-Za-z0-9,+\-]+)\s*\}/g, "$1_{$2}")
    .replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, (match, base, subscript) => {
      return isLikelyMathSubscript(base, subscript) ? base + "_" + subscript : match;
    });
}

function isLikelyMathSubscript(base, subscript) {
  return /^[A-Za-z]$/.test(base) && /^[ijknmtxy]$/i.test(subscript);
}

function isLuoguNoiseLine(line) {
  const value = String(line || "").trim();
  const lower = value.toLowerCase();

  if (isLuoguAdLine(value, lower)) {
    return true;
  }

  if (/^(复制|提交|保存|取消|展开|收起|返回|登录|注册|分享|关注|举报|收藏|点赞|评论|回复)$/.test(value)) {
    return true;
  }

  if (isUsefulLuoguHintLine(value)) {
    return false;
  }

  if (/^(广告|推广|赞助|推荐|热门推荐|相关推荐|猜你喜欢|下载 App|打开 App|扫码|微信|QQ|微博|加入我们)/i.test(value)) {
    return true;
  }

  if (/(广告|推广|赞助商|立即下载|限时优惠|点击查看|扫码关注|打开APP|打开 App|APP 内打开)/i.test(value) && value.length <= 80) {
    return true;
  }

  return false;
}

function isLuoguAdLine(value, lower) {
  if (/(taobao\.com|tmall\.com|jd\.com|pinduoduo\.com|item\.taobao|click\.taobao|item\.htm\?)/i.test(lower)) {
    return true;
  }

  if (/(官方网店|店铺|热卖|购买|下单|优惠券|限时优惠|洛谷出品|算法教材|帮助您更简单的学习|绝赞热卖)/.test(value)) {
    return true;
  }

  if (/^[?&]?(id|spm|skuId|itemId|abbucket|scene|utparam)=/i.test(value)) {
    return true;
  }

  if (/^\s*\[?!?\[.*\]\(https?:\/\/[^)]+\)\]\(https?:\/\/[^)]+\)\s*$/.test(value) && /(淘宝|taobao|tmall|店铺|热卖|购买)/i.test(value)) {
    return true;
  }

  return false;
}

function isUsefulLuoguHintLine(value) {
  return /(数据规模|约定|保证|范围|限制|提示|说明|样例解释|输入|输出|测试点|特殊|注意|其中|对于全部|对于.*测试点|时间限制|空间限制|0\s*[<≤]|[<≤]\s*\d|复杂度)/.test(value);
}

function finalizeLuoguProblemText(text) {
  const protectedLinks = [];
  const sectionedText = normalizeLuoguProblemSections(removeEmptyLuoguHintSections(text));
  const preparedText = protectLuoguInlineMetaAndNoteLinks(sectionedText, protectedLinks);

  return normalizeLuoguSampleValues(restoreLuoguProtectedLinks(moveLuoguLinksToEnd(preparedText), protectedLinks))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLuoguSampleValues(text) {
  const lines = String(text || "").split("\n");
  const nextLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\/\S+$/.test(trimmed) && nextLines.length > 0 && /\d$/.test(nextLines[nextLines.length - 1].trim())) {
      nextLines[nextLines.length - 1] = nextLines[nextLines.length - 1].replace(/\s+$/, "") + trimmed;
      continue;
    }

    nextLines.push(line);
  }

  return nextLines.join("\n");
}

function normalizeLuoguProblemSections(text) {
  const lines = explodeLuoguProblemLines(String(text || ""))
    .split("\n")
    .map((line) => line.trimEnd());
  const nextLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^[:：]$/.test(line)) {
      continue;
    }

    if (!line) {
      pushLuoguBlankLine(nextLines);
      continue;
    }

    const inlineSection = splitInlineLuoguProblemSection(line);

    if (inlineSection) {
      pushLuoguBlankLine(nextLines);
      nextLines.push(inlineSection.heading);
      pushLuoguBlankLine(nextLines);
      if (inlineSection.content) {
        nextLines.push(inlineSection.content);
      }
      continue;
    }

    if (isLuoguProblemSectionHeading(line) || isLuoguSampleBlockHeading(line)) {
      pushLuoguBlankLine(nextLines);
      nextLines.push(normalizeLuoguProblemHeading(line));
      pushLuoguBlankLine(nextLines);
      continue;
    }

    nextLines.push(rawLine);
  }

  return nextLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pushLuoguBlankLine(lines) {
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
}

function isLuoguProblemSectionHeading(line) {
  return /^(题目背景|题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示|数据规模与约定|数据范围|限制)[:：]?$/.test(line) ||
    isLuoguSampleExplanationHeading(line);
}

function isLuoguSampleBlockHeading(line) {
  return /^(样例\s*\d*\s*(?:输入|输出)|(?:输入|输出)\s*#\s*\d+)[:：]?$/.test(line);
}

function explodeLuoguProblemLines(text) {
  return String(text || "")
    .split("\n")
    .flatMap((line) => splitLuoguProblemLineByHeadings(line))
    .join("\n");
}

function splitLuoguProblemLineByHeadings(line) {
  const sampleExplanationParts = splitLuoguSampleExplanationLine(line);

  if (sampleExplanationParts) {
    return sampleExplanationParts;
  }

  const parts = [];
  let remaining = String(line || "").trimEnd();

  while (remaining) {
    const match = findNextLuoguProblemHeading(remaining);

    if (!match) {
      parts.push(remaining);
      break;
    }

    if (match.index > 0) {
      const prefix = remaining.slice(0, match.index).trimEnd();

      if (prefix) {
        parts.push(prefix);
      }
    }

    parts.push(match.heading);
    remaining = remaining.slice(match.index + match.heading.length).trimStart();
  }

  return parts.length > 0 ? parts : [line];
}

function findNextLuoguProblemHeading(line) {
  const headingPattern = /(题目背景|题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示|数据规模与约定|数据范围|限制|样例\s*\d*\s*(?:输入|输出)|(?:输入|输出)\s*#\s*\d+)/g;
  let result = null;

  for (const match of String(line || "").matchAll(headingPattern)) {
    const index = match.index || 0;
    const heading = match[1];

    if (isLuoguHeadingInsideBracketedText(line, index, heading)) {
      continue;
    }

    if (index === 0) {
      return { index, heading };
    }

    const previousChar = line[index - 1];

    if (/[。！？:\s]/.test(previousChar)) {
      return { index, heading };
    }

    if (!result) {
      result = { index, heading };
    }
  }

  return result;
}

function splitInlineLuoguProblemSection(line) {
  const sampleExplanationMatch = String(line || "").match(/^[【\[]?\s*(样例\s*\d+\s*(?:说明|解释))\s*[】\]]?[:：]?\s+(.+)$/);

  if (sampleExplanationMatch) {
    return {
      heading: normalizeLuoguProblemHeading(sampleExplanationMatch[1]),
      content: sampleExplanationMatch[2] || ""
    };
  }

  const match = String(line || "").match(/^(题目背景|题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示|数据规模与约定|数据范围|限制|样例\s*\d*\s*(?:输入|输出)|(?:输入|输出)\s*#\s*\d+)[:：]?\s+(.+)$/);

  if (!match) {
    return null;
  }

  return {
    heading: normalizeLuoguProblemHeading(match[1]),
    content: match[2] || ""
  };
}

function normalizeLuoguProblemHeading(line) {
  const value = String(line || "").trim();
  const cleanValue = value.replace(/^\*\*/, "").replace(/\*\*$/, "").replace(/[:：]$/, "");
  const bracketlessValue = cleanValue.replace(/^[【\[]\s*/, "").replace(/\s*[】\]]$/, "").trim();

  if (/^样例\s*\d+\s*(?:说明|解释)$/.test(bracketlessValue)) {
    return bracketlessValue + "：";
  }

  if (/^(题目描述|输入格式|输出格式|输入输出样例|(?:输入|输出)\s*#\s*\d+|说明\/提示)$/.test(bracketlessValue)) {
    return bracketlessValue + "：";
  }

  return bracketlessValue || cleanValue || value;
}

function splitLuoguSampleExplanationLine(line) {
  const match = String(line || "").match(/^([【\[]?\s*样例\s*\d+\s*(?:说明|解释)\s*[】\]]?[:：]?)(?:\s+(.+))?$/);

  if (!match) {
    return null;
  }

  return [match[1], match[2]].filter(Boolean);
}

function isLuoguSampleExplanationHeading(line) {
  return /^[【\[]?\s*样例\s*\d+\s*(?:说明|解释)\s*[】\]]?[:：]?$/.test(String(line || "").trim());
}

function isLuoguHeadingInsideBracketedText(line, index, heading) {
  const before = String(line || "").slice(0, index);
  const after = String(line || "").slice(index + String(heading || "").length);
  const chineseOpen = before.lastIndexOf("【");
  const chineseClose = before.lastIndexOf("】");
  const squareOpen = before.lastIndexOf("[");
  const squareClose = before.lastIndexOf("]");

  return (chineseOpen > chineseClose && after.includes("】")) ||
    (squareOpen > squareClose && after.includes("]"));
}

function protectLuoguInlineMetaAndNoteLinks(text, protectedLinks) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      if (!shouldProtectLuoguInlineLinks(line)) {
        return line;
      }

      return line.replace(/https?:\/\/\S+/g, (url) => {
        const marker = "__CODING_ASSISTANT_INLINE_URL_" + protectedLinks.length + "__";
        protectedLinks.push(url);
        return marker;
      });
    })
    .join("\n");
}

function shouldProtectLuoguInlineLinks(line) {
  const value = String(line || "").trim();
  return /^([^：:]{0,12}地址|URL|Url|url)[:：]\s*https?:\/\//.test(value) ||
    /^(\*\*)?\[链接\d+\](\*\*)?/.test(value) ||
    /^(\*\*)?链接注释(\*\*)?[:：]/.test(value);
}

function restoreLuoguProtectedLinks(text, protectedLinks) {
  return String(text || "").replace(/__CODING_ASSISTANT_INLINE_URL_(\d+)__/g, (_, index) => {
    return protectedLinks[Number(index)] || "";
  });
}

function removeEmptyLuoguHintSections(text) {
  const lines = String(text || "").split("\n");
  const nextLines = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();

    if (!isLuoguHintSectionHeading(line)) {
      nextLines.push(lines[index]);
      index += 1;
      continue;
    }

    const sectionEnd = findNextLuoguTopLevelSectionIndex(lines, index + 1);
    const sectionLines = lines
      .slice(index + 1, sectionEnd)
      .map((item) => item.trim())
      .filter(Boolean);

    if (sectionLines.length === 0 || sectionLines.every((item) => isLuoguNoiseLine(item))) {
      index = sectionEnd;
      continue;
    }

    nextLines.push(lines[index]);
    index += 1;
  }

  return nextLines.join("\n").trim();
}

function isLuoguHintSectionHeading(line) {
  return /^(说明\/提示|说明|提示)[:：]?$/.test(line);
}

function findNextLuoguTopLevelSectionIndex(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (isLuoguTopLevelProblemSection(lines[index].trim())) {
      return index;
    }
  }

  return lines.length;
}

function isLuoguTopLevelProblemSection(line) {
  return /^(题目背景|题目描述|输入格式|输出格式|输入输出样例|样例|样例输入|样例输出)[:：]?$/.test(line);
}

function moveLuoguLinksToEnd(text) {
  const notes = [];
  let nextText = String(text || "");

  nextText = nextText.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    return createLuoguLinkMarker(notes, label || "图片", url);
  });

  nextText = nextText.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    return createLuoguLinkMarker(notes, label, url);
  });

  nextText = nextText.replace(/(^|[\s（(:：])((?:https?:\/\/)[^\s）)]+)(?=$|[\s）)])/g, (match, prefix, url) => {
    return prefix + createLuoguLinkMarker(notes, "链接", url);
  });

  if (notes.length === 0) {
    return nextText.trim();
  }

  return [
    nextText.trim(),
    "",
    "**链接注释**：原文中的 **[链接编号]** 已统一移到这里，避免网址打断题面阅读。",
    ...notes.map((note, index) => "**[链接" + (index + 1) + "]** " + note.label + "：" + note.url)
  ].join("\n");
}

function createLuoguLinkMarker(notes, label, url) {
  const cleanLabel = String(label || "链接").replace(/\s+/g, " ").trim();
  const cleanUrl = String(url || "").replace(/[.,;，。；]+$/g, "");
  const combined = cleanLabel + " " + cleanUrl;

  if (isLuoguImageLinkLabel(cleanLabel) || isLuoguImageUrl(cleanUrl)) {
    return "";
  }

  if (isLuoguAdLine(combined, combined.toLowerCase())) {
    return cleanLabel === "链接" ? "" : cleanLabel;
  }

  notes.push({
    label: cleanLabel,
    url: cleanUrl
  });

  return cleanLabel + "**[链接" + notes.length + "]**";
}

function isLuoguImageLinkLabel(label) {
  return label === "图片" ||
    /^!\[/.test(label) ||
    /https?:\/\/[^\s)]+\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(label) ||
    /image_hosting/i.test(label);
}

function isLuoguImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) || /image_hosting/i.test(url);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)));
}

function normalizeTimeout(value) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds)) {
    return 90;
  }

  return Math.min(300, Math.max(30, Math.round(seconds)));
}

function getMaxTokens(messages) {
  const text = (messages || []).map((message) => message.content || "").join("\n");

  if (text.includes("建议代码") || text.includes("下一步说明")) {
    return 1200;
  }

  if (text.includes("检查结论") || text.includes("问题列表")) {
    return 1800;
  }

  return 1600;
}

function compactText(value, maxLength) {
  const text = String(value || "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + "\n[内容过长，后续部分已省略]";
}

function getLocalProblemSourceLine(platform) {
  if (platform === "luogu") {
    return "鏉ユ簮锛氭礇璋烽〉闈?";
  }

  if (platform === "leetcode") {
    return "鏉ユ簮锛氬姏鎵ｉ〉闈?";
  }

  return "";
}

function buildLocalProblem(payload) {
  const pageText = cleanLuoguProblemText(payload.pageText || "");
  const selection = cleanLuoguProblemText(payload.selection || "");

  if (isStructuredLuoguProblemText(pageText)) {
    if (selection && !pageText.includes(selection)) {
      return finalizeLuoguProblemText([
        pageText,
        "",
        "选中内容：",
        "",
        selection
      ].join("\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
    }

    return pageText.slice(0, PROBLEM_TEXT_LIMIT).trim();
  }

  return finalizeLuoguProblemText([
    payload.platform === "luogu" ? "来源：洛谷页面" : "",
    payload.problemId ? "题号：" + payload.problemId : "",
    payload.pageTitle ? "页面标题：" + payload.pageTitle : "",
    payload.pageUrl ? "页面地址：" + payload.pageUrl : "",
    selection ? "\n选中内容：\n" + compactText(selection, 4000) : "",
    pageText ? "\n页面正文：\n" + compactText(pageText, PROBLEM_TEXT_LIMIT) : ""
  ].filter(Boolean).join("\n")).slice(0, PROBLEM_TEXT_LIMIT).trim();
}

function isStructuredLuoguProblemText(text) {
  const value = String(text || "").trim();

  if (!value) {
    return false;
  }

  const firstChunk = value.slice(0, 400);
  return /(来源：|题号：|标题：|页面地址：)/.test(firstChunk) &&
    /(题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示)/.test(value);
}

function normalizeProblemFromServer(data, rawText) {
  if (!data) {
    return String(rawText || "").trim();
  }

  if (typeof data === "string") {
    return data.trim();
  }

  const candidates = [
    data.problem,
    data.question,
    data.description,
    data.content,
    data.context,
    data.text,
    data.data && data.data.problem,
    data.data && data.data.question,
    data.data && data.data.description,
    data.data && data.data.content,
    data.data && data.data.context
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function looksLikeHtml(text) {
  const value = String(text || "").trim().toLowerCase();
  return value.startsWith("<!doctype html") || value.startsWith("<html") || value.includes("<div id=\"root\"");
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getErrorMessage(data, rawText) {
  if (data && data.error && data.error.message) {
    return data.error.message;
  }

  if (data && data.message) {
    return data.message;
  }

  return rawText ? String(rawText).slice(0, 500) : "";
}

function extractAnswer(data, rawText) {
  if (!data) {
    return rawText || "";
  }

  if (data.choices && data.choices[0]) {
    const choice = data.choices[0];

    if (choice.message && typeof choice.message.content === "string") {
      return choice.message.content;
    }

    if (choice.message && Array.isArray(choice.message.content)) {
      return choice.message.content
        .map((item) => item.text || item.content || "")
        .join("");
    }

    if (typeof choice.text === "string") {
      return choice.text;
    }
  }

  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  if (Array.isArray(data.output)) {
    return data.output
      .flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .join("");
  }

  return "";
}
