(function () {
  const UI_VERSION = "codemate-v1";
  const EXISTING_HOST_ID = "coding-study-assistant-root";
  const existingHost = document.getElementById(EXISTING_HOST_ID);

  if (existingHost && existingHost.dataset.uiVersion !== UI_VERSION) {
    existingHost.remove();
    window.__codingStudyAssistantLoaded = false;
  }

  if (window.__codingStudyAssistantLoaded && document.getElementById(EXISTING_HOST_ID)) {
    return;
  }

  window.__codingStudyAssistantLoaded = true;

  const DRAFT_VERSION = 17;
  const DRAFT_HISTORY_LIMIT = 5;
  const DRAFT_HISTORY_MIN_INTERVAL = 15000;
  const PROBLEM_TEXT_LIMIT = 30000;
  const MAX_AI_INSERT_SNAPSHOTS = 10;
  const SUGGESTION_SCOPE_CONFIG = {
    small: {
      label: "只补光标处一小段",
      note: "默认最稳，只让 AI 补光标附近几行。",
      instruction: "只补光标附近接下来要写的一小段代码，不要扩展到当前局部逻辑之外。"
    },
    block: {
      label: "只补当前代码块",
      note: "限制在当前 if/for/while/switch 或最近一层代码块内。",
      instruction: "建议代码只能落在光标所在的当前代码块内，例如当前 if、for、while、else、switch case 或同层代码块。"
    },
    function: {
      label: "只补当前函数",
      note: "限制在当前函数或方法内部，不去改其他函数。",
      instruction: "建议代码只能服务于光标所在的当前函数或方法，不要重写整个类，也不要补其他函数。"
    }
  };

  let lastEditable = null;
  let lastProblemContext = "";
  let lastServerSource = "页面";
  let lastSuggestion = "";
  let lastLeetCodeInsertError = "";
  let lastLeetCodeTemplateCode = "";
  let lastLeetCodeTemplateUrl = "";
  let lastLeetCodeTemplateLanguage = "";
  let aiInsertSnapshots = [];
  let launcherBottom = 22;
  let launcherLeft = 0;
  let launcherSide = "right";
  let launcherAnchorSide = "right";
  let launcherAnchorOffset = 22;
  let dragState = null;
  let panelLeft = 22;
  let panelTop = 104;
  let panelDragState = null;
  let panelResizeState = null;
  let assistantHidden = false;
  let formatCodeButtonResetTimer = 0;
  let lineLocateFlashTimer = 0;
  let pendingSuggestionPreview = null;
  let activeAiRequest = null;
  let aiRequestSequence = 0;
  let draftHistory = [];
  let lastDraftHistoryCode = "";
  let lastDraftHistorySavedAt = 0;

  document.addEventListener("focusin", (event) => {
    if (isEditable(event.target)) {
      lastEditable = event.target;
    }
  });

  const host = document.createElement("div");
  host.id = EXISTING_HOST_ID;
  host.dataset.uiVersion = UI_VERSION;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light;
        --ink: #102033;
        --muted: #65758b;
        --paper: #fffaf0;
        --panel: #fffdf7;
        --line: rgba(16, 32, 51, 0.14);
        --accent: #e17838;
        --accent-2: #f0b84d;
        --soft: #f7ead7;
        --good: #17633d;
        --bad: #b42318;
        font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      button,
      textarea,
      select {
        font: inherit;
      }

      .launcher {
        position: fixed;
        left: auto;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 52px;
        height: 52px;
        border: 1px solid rgba(225, 120, 56, 0.28);
        border-radius: 18px;
        background: linear-gradient(145deg, #fff8e8, #ffd28e);
        color: #48220a;
        box-shadow: 0 18px 36px rgba(123, 72, 30, 0.28);
        cursor: pointer;
        touch-action: none;
        user-select: none;
        display: grid;
        place-items: center;
        font-family: "Cascadia Code", Consolas, monospace;
        font-size: 16px;
        font-weight: 900;
        transition: transform 140ms ease, box-shadow 140ms ease;
      }

      .launcher.edge-hidden-left {
        transform: translateX(-42%);
      }

      .launcher.edge-hidden-right {
        transform: translateX(42%);
      }

      .launcher.edge-hidden-left:hover,
      .launcher.edge-hidden-right:hover,
      .launcher.edge-active {
        transform: translateX(0);
      }

      .panel {
        position: fixed;
        left: 22px;
        top: 104px;
        z-index: 2147483647;
        display: none;
        width: min(340px, calc(100vw - 24px));
        height: min(570px, calc(100vh - 52px));
        min-width: 320px;
        min-height: 420px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 20px);
        overflow: hidden;
        resize: both;
        container-type: inline-size;
        border: 1px solid rgba(225, 120, 56, 0.22);
        border-radius: 28px;
        background:
          radial-gradient(circle at 8% 0%, rgba(240, 184, 77, 0.2), transparent 28%),
          linear-gradient(180deg, var(--paper), var(--panel));
        color: var(--ink);
        box-shadow: 0 24px 70px rgba(16, 32, 51, 0.25);
      }

      .panel,
      .panel * {
        box-sizing: border-box;
      }

      .panel.open {
        display: grid;
        grid-template-rows: auto 1fr auto;
      }

      .panel-resize-top-left {
        position: absolute;
        left: 7px;
        top: 7px;
        z-index: 3;
        width: 18px;
        height: 18px;
        border-radius: 6px;
        background:
          radial-gradient(circle, rgba(90, 43, 12, 0.5) 1.4px, transparent 1.6px) 1px 1px / 6px 6px;
        cursor: nwse-resize;
        opacity: 0.58;
        touch-action: none;
        transition: opacity 120ms ease, background-color 120ms ease;
      }

      .panel-resize-top-left:hover {
        opacity: 1;
        background-color: rgba(240, 184, 77, 0.14);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 15px 18px 15px 30px;
        cursor: move;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 248, 232, 0.84);
      }

      .header strong {
        display: block;
        font-size: 16px;
        letter-spacing: 0.02em;
      }

      .header span {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
      }

      .close {
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 13px;
        background: #f5ddbf;
        color: #5a2b0c;
        cursor: pointer;
        font-weight: 900;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
      }

      .external-editor {
        height: 36px;
        padding: 0 12px;
        border-radius: 13px;
        background: #e8eadc;
        color: #405022;
        white-space: nowrap;
      }

      .body {
        --code-shell-min-height: 260px;
        display: grid;
        grid-template-rows: auto auto minmax(86px, 0.35fr) auto auto minmax(260px, 1.15fr) minmax(240px, 1fr);
        gap: 11px;
        min-height: 0;
        padding: 14px;
        overflow: auto;
      }

      .panel.reading-mode .body {
        --code-shell-min-height: 190px;
        grid-template-rows: auto auto minmax(58px, 0.2fr) auto auto minmax(190px, 0.7fr) minmax(320px, 1.45fr);
      }

      .panel.problem-expanded .body {
        --code-shell-min-height: 130px;
        grid-template-rows: auto auto minmax(430px, 1.7fr) auto auto minmax(130px, 0.45fr) minmax(130px, 0.45fr);
      }

      .panel.reading-mode.problem-expanded .body {
        --code-shell-min-height: 190px;
        grid-template-rows: auto auto minmax(58px, 0.2fr) auto auto minmax(190px, 0.7fr) minmax(320px, 1.45fr);
      }

      .status-row,
      .control-row,
      .actions,
      .scope-row {
        display: grid;
        gap: 10px;
      }

      .status-row {
        grid-template-columns: 1fr auto auto;
        align-items: center;
      }

      .status {
        order: 1;
      }

      .problem-toggle {
        order: 2;
      }

      .sync {
        order: 3;
      }

      .control-row {
        grid-template-columns: 180px 1fr;
      }

      .actions {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .scope-row {
        grid-template-columns: 190px 1fr;
        align-items: center;
      }

      .scope-note {
        white-space: normal;
      }

      .code-shell {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        min-height: var(--code-shell-min-height);
        min-width: 0;
      }

      .code-tools {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 0 2px;
      }

      .code-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .code-tool-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .code-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.04em;
      }

      .cursor-position {
        color: var(--muted);
        font: 12px/1.2 "Cascadia Code", Consolas, "Microsoft YaHei", monospace;
        white-space: nowrap;
      }

      .tool-button {
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 12px;
        line-height: 1;
      }

      .draft-history {
        width: 118px;
        padding: 8px 10px;
        border-radius: 999px;
        font-size: 12px;
        line-height: 1;
      }

      .pill {
        min-width: 0;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.72);
        color: var(--muted);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      select,
      textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid var(--line);
        outline: 0;
        background: rgba(255, 255, 255, 0.76);
        color: var(--ink);
      }

      select {
        border-radius: 14px;
        padding: 10px 12px;
      }

      textarea {
        resize: none;
        border-radius: 18px;
        padding: 12px;
        line-height: 1.55;
      }

      .problem {
        min-height: 0;
        height: 100%;
        overflow: auto;
        font-size: 13px;
        color: #24374d;
      }

      .panel.reading-mode .problem {
        min-height: 0;
      }

      .panel.problem-expanded .problem {
        min-height: 0;
      }

      .code-editor {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        min-height: 0;
        height: 100%;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 18px;
        background:
          linear-gradient(90deg, rgba(225, 120, 56, 0.08) 1px, transparent 1px),
          rgba(255, 255, 255, 0.84);
        background-size: 42px 100%;
      }

      .line-numbers {
        min-width: 42px;
        max-width: 72px;
        overflow: hidden;
        padding: 12px 8px 12px 10px;
        border-right: 1px solid rgba(16, 32, 51, 0.1);
        background: rgba(247, 234, 215, 0.52);
        color: rgba(101, 117, 139, 0.82);
        font: 13px/1.55 "Cascadia Code", Consolas, "Microsoft YaHei", monospace;
        text-align: right;
        user-select: none;
      }

      .line-number {
        height: 1.55em;
        white-space: nowrap;
      }

      .line-number.current {
        color: #5a2b0c;
        font-weight: 900;
      }

      .code-input-layer {
        position: relative;
        min-width: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
      }

      .current-line-highlight {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 20px;
        z-index: 0;
        pointer-events: none;
        background: rgba(240, 184, 77, 0.18);
        border-block: 1px solid rgba(225, 120, 56, 0.12);
        opacity: 1;
        transform: translateY(12px);
        transition: background-color 140ms ease, border-color 140ms ease;
      }

      .code-editor.line-located .current-line-highlight {
        background: rgba(225, 120, 56, 0.26);
        border-block-color: rgba(225, 120, 56, 0.32);
      }

      .code-editor.suggestion-preview .current-line-highlight {
        background: rgba(23, 99, 61, 0.16);
        border-block-color: rgba(23, 99, 61, 0.28);
      }

      .code-editor.suggestion-preview .line-number.current {
        color: var(--good);
      }

      .code {
        display: block;
        position: relative;
        z-index: 1;
        min-height: 0;
        height: 100%;
        border: 0;
        border-radius: 0;
        padding-left: 10px;
        font: 13px/1.55 "Cascadia Code", Consolas, "Microsoft YaHei", monospace;
        background: transparent;
        tab-size: 2;
      }

      .output {
        margin: 0;
        min-height: 220px;
        overflow: auto;
        padding: 13px;
        border: 1px solid rgba(225, 120, 56, 0.18);
        border-radius: 18px;
        background: #fff4df;
        color: #26384f;
        font: 13px/1.65 "Cascadia Code", Consolas, "Microsoft YaHei", monospace;
        white-space: pre-wrap;
        user-select: text;
        overscroll-behavior: contain;
      }

      .panel.reading-mode .output {
        min-height: 300px;
      }

      .output .line-reference {
        display: inline;
        margin: 0 1px;
        padding: 0 3px;
        border: 0;
        border-radius: 4px;
        background: rgba(225, 120, 56, 0.12);
        color: #8a3f0d;
        font: inherit;
        font-weight: 900;
        line-height: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
        white-space: inherit;
        cursor: pointer;
      }

      .output .line-reference:hover {
        background: rgba(225, 120, 56, 0.22);
      }

      button {
        border: 0;
        border-radius: 15px;
        padding: 10px 12px;
        cursor: pointer;
        font-weight: 900;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.66;
      }

      .sync,
      .problem-toggle,
      .secondary {
        background: var(--soft);
        color: #5a2b0c;
      }

      .primary {
        background: linear-gradient(135deg, var(--accent), var(--accent-2));
        color: #231100;
      }

      .danger {
        background: #f9dfd7;
        color: #8f2a17;
      }

      .footer {
        padding: 8px 14px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 12px;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @container (max-width: 560px) {
        .body {
          --code-shell-min-height: 220px;
          grid-template-rows: auto auto minmax(72px, 0.35fr) auto auto minmax(220px, 1fr) minmax(220px, 1fr);
        }

        .status-row,
        .control-row,
        .actions,
        .scope-row {
          grid-template-columns: 1fr;
        }

        .panel.problem-expanded .body {
          --code-shell-min-height: 160px;
          grid-template-rows: auto auto minmax(360px, 1.5fr) auto auto minmax(160px, 0.7fr) minmax(160px, 0.7fr);
        }
      }

      @media (max-width: 560px) {
        .panel {
          left: 10px;
          top: 66px;
          width: calc(100vw - 20px);
          min-width: 0;
        }

        .body {
          --code-shell-min-height: 220px;
          grid-template-rows: auto auto minmax(72px, 0.35fr) auto auto minmax(220px, 1fr) minmax(220px, 1fr);
        }

        .status-row,
        .control-row,
        .actions,
        .scope-row {
          grid-template-columns: 1fr;
        }

        .panel.problem-expanded .body {
          --code-shell-min-height: 160px;
          grid-template-rows: auto auto minmax(360px, 1.5fr) auto auto minmax(160px, 0.7fr) minmax(160px, 0.7fr);
        }
      }
    </style>

    <button class="launcher" type="button" title="打开 码伴 CodeMate">码</button>
    <section class="panel" aria-label="码伴 CodeMate">
      <div class="panel-resize-top-left" title="从左上角拉伸" aria-hidden="true"></div>
      <header class="header">
        <div>
          <strong>码伴 CodeMate</strong>
          <span>在下面直接写代码，AI 会按当前光标位置给下一段建议并检查已有错误</span>
        </div>
        <div class="header-actions">
          <button class="external-editor" type="button" title="在独立窗口继续编辑">独立</button>
          <button class="close" type="button" title="关闭">X</button>
        </div>
      </header>

      <div class="body">
        <div class="status-row">
          <button class="problem-toggle" type="button">放大题面</button>
          <div class="pill status">题目上下文：等待同步</div>
          <button class="sync" type="button">同步题目</button>
        </div>

        <div class="control-row">
          <select class="language" aria-label="编程语言">
            <option value="auto">自动识别</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="c">C</option>
            <option value="cpp98">C++98</option>
            <option value="cpp11">C++11</option>
            <option value="cpp14">C++14</option>
            <option value="cpp17">C++17</option>
            <option value="cpp20">C++20</option>
            <option value="java8">Java 8</option>
            <option value="java11">Java 11</option>
            <option value="java17">Java 17</option>
            <option value="csharp">C#</option>
            <option value="go">Go</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
          </select>
          <div class="pill source">来源：页面内容</div>
        </div>

        <textarea class="problem" placeholder="题目上下文会自动从当前网页或配置的服务器读取，也可以在这里手动补充。"></textarea>

        <div class="actions">
          <button class="primary next" type="button">下一段该写什么</button>
          <button class="danger check" type="button">检查已有代码</button>
          <button class="danger stop-ai" type="button" hidden>停止生成</button>
          <button class="secondary insert-suggestion" type="button">插入建议</button>
          <button class="secondary insert-page" type="button">插入到页面</button>
          <button class="secondary explain-selection" type="button">解释选中代码</button>
          <button class="secondary undo-insert" type="button" disabled>撤销插入</button>
        </div>

        <div class="scope-row">
          <select class="suggestion-scope" aria-label="建议范围">
            <option value="small">只补光标处一小段</option>
            <option value="block">只补当前代码块</option>
            <option value="function">只补当前函数</option>
          </select>
          <div class="pill scope-note">建议范围：只补光标处一小段</div>
        </div>

        <div class="code-shell">
          <div class="code-tools">
            <div class="code-heading">
              <span class="code-label">代码</span>
              <span class="cursor-position">行 1，列 1</span>
            </div>
            <div class="code-tool-actions">
              <select class="draft-history" aria-label="最近草稿">
                <option value="">最近草稿</option>
              </select>
              <button class="secondary tool-button format-code" type="button">格式化</button>
            </div>
          </div>
          <div class="code-editor">
            <div class="line-numbers" aria-hidden="true"></div>
            <div class="code-input-layer">
              <div class="current-line-highlight" aria-hidden="true"></div>
              <textarea class="code" spellcheck="false" placeholder="在这里敲代码。把光标停在你写到的位置，然后点击“下一段该写什么”。"></textarea>
            </div>
          </div>
        </div>

        <pre class="output" tabindex="0">打开后会自动尝试同步题目。你可以直接写代码，AI 会根据当前代码、光标位置和题目上下文给出下一段建议或错误检查。</pre>
      </div>

      <div class="footer">如果配置了题目服务器，会优先向服务器发送当前页面 URL、标题、页面文本和当前代码；未配置时使用当前网页正文作为题目上下文。</div>
    </section>
  `;

  const launcher = shadow.querySelector(".launcher");
  const panel = shadow.querySelector(".panel");
  const panelResizeTopLeft = shadow.querySelector(".panel-resize-top-left");
  const header = shadow.querySelector(".header");
  const closeButton = shadow.querySelector(".close");
  const statusText = shadow.querySelector(".status");
  const sourceText = shadow.querySelector(".source");
  const problemInput = shadow.querySelector(".problem");
  const lineNumbers = shadow.querySelector(".line-numbers");
  const currentLineHighlight = shadow.querySelector(".current-line-highlight");
  const codeEditor = shadow.querySelector(".code-editor");
  const codeInput = shadow.querySelector(".code");
  const cursorPositionText = shadow.querySelector(".cursor-position");
  const output = shadow.querySelector(".output");
  const languageSelect = shadow.querySelector(".language");
  const problemToggleButton = shadow.querySelector(".problem-toggle");
  const syncButton = shadow.querySelector(".sync");
  const nextButton = shadow.querySelector(".next");
  const checkButton = shadow.querySelector(".check");
  const stopAiButton = shadow.querySelector(".stop-ai");
  const insertSuggestionButton = shadow.querySelector(".insert-suggestion");
  const insertSuggestionButtonDefaultText = insertSuggestionButton.textContent;
  const insertPageButton = shadow.querySelector(".insert-page");
  const explainSelectionButton = shadow.querySelector(".explain-selection");
  const undoInsertButton = shadow.querySelector(".undo-insert");
  const externalEditorButton = shadow.querySelector(".external-editor");
  const suggestionScopeSelect = shadow.querySelector(".suggestion-scope");
  const suggestionScopeNote = shadow.querySelector(".scope-note");
  const draftHistorySelect = shadow.querySelector(".draft-history");
  const formatCodeButton = shadow.querySelector(".format-code");

  updateSuggestionScopeNote();
  updateUndoInsertButton();
  syncCodeEditorMetrics();
  applyShortcutTitles();
  updateDraftHistorySelect();
  updateActionButtonStates();

  function isEditable(element) {
    if (!element) return false;
    const tagName = element.tagName ? element.tagName.toLowerCase() : "";
    return tagName === "textarea" || tagName === "input" || element.isContentEditable;
  }

  function sanitizeText(value) {
    return String(value || "").replace(/\u0000/g, "").trim();
  }

  function isExtensionContextAvailable() {
    try {
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function getRuntimeLastErrorMessage() {
    try {
      return chrome.runtime.lastError && chrome.runtime.lastError.message;
    } catch (error) {
      return error && error.message ? error.message : String(error);
    }
  }

  function createExtensionContextError() {
    return new Error("扩展上下文已失效。请刷新当前页面后再使用 码伴 CodeMate。");
  }

  function safeStorageGet(keys, callback) {
    if (!isExtensionContextAvailable() || !chrome.storage || !chrome.storage.local) {
      callback({});
      return;
    }

    try {
      chrome.storage.local.get(keys, (items) => {
        if (getRuntimeLastErrorMessage()) {
          callback({});
          return;
        }

        callback(items || {});
      });
    } catch {
      callback({});
    }
  }

  function safeStorageSet(items, callback) {
    if (!isExtensionContextAvailable() || !chrome.storage || !chrome.storage.local) {
      if (callback) {
        callback(false);
      }
      return;
    }

    try {
      chrome.storage.local.set(items, () => {
        const ok = !getRuntimeLastErrorMessage();

        if (callback) {
          callback(ok);
        }
      });
    } catch {
      if (callback) {
        callback(false);
      }
    }
  }

  function safeAddStorageChangedListener(listener) {
    try {
      if (isExtensionContextAvailable() && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(listener);
      }
    } catch {
      // The page may still contain an old content script after the extension is reloaded.
    }
  }

  function safeAddRuntimeMessageListener(listener) {
    try {
      if (isExtensionContextAvailable() && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(listener);
      }
    } catch {
      // The page may still contain an old content script after the extension is reloaded.
    }
  }

  function getSelectedSuggestionScope() {
    const value = suggestionScopeSelect && suggestionScopeSelect.value;
    return SUGGESTION_SCOPE_CONFIG[value] ? value : "small";
  }

  function updateSuggestionScopeNote() {
    if (!suggestionScopeNote) {
      return;
    }

    const scope = getSelectedSuggestionScope();
    suggestionScopeNote.textContent = "建议范围：" + SUGGESTION_SCOPE_CONFIG[scope].note;
  }

  function syncCodeEditorMetrics() {
    updateCodeLineNumbers();
    syncCodeCursorState();
    syncCodeLineNumberScroll();
  }

  function updateCodeLineNumbers() {
    if (!lineNumbers) {
      return;
    }

    const lineCount = Math.max(1, codeInput.value.split("\n").length);
    const currentLineCount = Number(lineNumbers.dataset.lineCount || "0");

    if (currentLineCount === lineCount) {
      return;
    }

    const fragment = document.createDocumentFragment();

    for (let line = 1; line <= lineCount; line += 1) {
      const row = document.createElement("div");
      row.className = "line-number";
      row.textContent = String(line);
      fragment.appendChild(row);
    }

    lineNumbers.replaceChildren(fragment);
    lineNumbers.dataset.lineCount = String(lineCount);
    lineNumbers.style.minWidth = Math.min(72, Math.max(42, String(lineCount).length * 8 + 24)) + "px";
  }

  function syncCodeLineNumberScroll() {
    if (!lineNumbers) {
      return;
    }

    lineNumbers.scrollTop = codeInput.scrollTop;
    updateCurrentLineHighlight();
  }

  function syncCodeCursorState() {
    const position = getCodeCursorPosition();
    updateCursorPositionText(position);
    updateActiveCodeLineNumber(position.line);
    updateCurrentLineHighlight(position);
  }

  function updateCursorPositionText(position = getCodeCursorPosition()) {
    if (cursorPositionText) {
      cursorPositionText.textContent = "行 " + position.line + "，列 " + position.column;
    }
  }

  function updateActiveCodeLineNumber(line) {
    if (!lineNumbers) {
      return;
    }

    const previous = lineNumbers.querySelector(".line-number.current");
    if (previous) {
      previous.classList.remove("current");
    }

    const current = lineNumbers.children[Math.max(0, line - 1)];
    if (current) {
      current.classList.add("current");
    }
  }

  function updateCurrentLineHighlight(position = getCodeCursorPosition()) {
    if (!currentLineHighlight) {
      return;
    }

    const style = window.getComputedStyle(codeInput);
    const fontSize = parseFloat(style.fontSize) || 13;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.55;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const top = paddingTop + (Math.max(1, position.line) - 1) * lineHeight - codeInput.scrollTop;

    currentLineHighlight.style.height = lineHeight + "px";
    currentLineHighlight.style.transform = "translateY(" + top + "px)";
  }

  function getCodeCursorPosition(offset = getSelectionStart(codeInput)) {
    const value = codeInput.value || "";
    const clampedOffset = Math.max(0, Math.min(offset, value.length));
    const beforeCursor = value.slice(0, clampedOffset);
    const line = beforeCursor.split("\n").length;
    const lineStart = beforeCursor.lastIndexOf("\n") + 1;

    return {
      line,
      column: clampedOffset - lineStart + 1
    };
  }

  function buildLineNumberedCode(code) {
    const lines = String(code || "").split("\n");
    const width = String(Math.max(1, lines.length)).length;

    return lines
      .map((line, index) => String(index + 1).padStart(width, " ") + " | " + line)
      .join("\n");
  }

  function renderOutputText(text, options = {}) {
    const value = String(text || "");

    if (!options.linkLineReferences) {
      output.textContent = value;
      return;
    }

    const fragment = document.createDocumentFragment();
    const pattern = /第\s*(\d{1,6})\s*行/g;
    let lastIndex = 0;
    let match = null;

    while ((match = pattern.exec(value))) {
      const matchedText = match[0];
      const line = Number(match[1]);

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
      }

      if (line > 0) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "line-reference";
        button.dataset.line = String(line);
        button.textContent = matchedText;
        button.title = "定位到代码第 " + line + " 行";
        fragment.appendChild(button);
      } else {
        fragment.appendChild(document.createTextNode(matchedText));
      }

      lastIndex = match.index + matchedText.length;
    }

    if (lastIndex < value.length) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
    }

    output.replaceChildren(fragment);
  }

  function handleOutputClick(event) {
    const target = event.target && event.target.closest
      ? event.target.closest(".line-reference")
      : null;

    if (!target || !output.contains(target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    locateCodeLine(Number(target.dataset.line));
  }

  function locateCodeLine(line) {
    const lines = String(codeInput.value || "").split("\n");
    const targetLine = Math.max(1, Math.min(lines.length, Number(line) || 1));
    const offset = getCodeLineStartOffset(targetLine);
    const metrics = getCodeInputMetrics();
    const visibleHeight = Math.max(metrics.lineHeight, codeInput.clientHeight - metrics.paddingTop - metrics.paddingBottom);
    const nextScrollTop = metrics.paddingTop + (targetLine - 1) * metrics.lineHeight - visibleHeight * 0.35;

    leaveReadingMode();

    try {
      codeInput.focus({ preventScroll: true });
    } catch {
      codeInput.focus();
    }

    codeInput.setSelectionRange(offset, offset);
    codeInput.scrollTop = Math.max(0, Math.min(codeInput.scrollHeight, nextScrollTop));
    syncCodeEditorMetrics();
    flashLocatedCodeLine();
  }

  function getCodeLineStartOffset(line) {
    const value = String(codeInput.value || "");
    let offset = 0;

    for (let currentLine = 1; currentLine < line; currentLine += 1) {
      const nextBreak = value.indexOf("\n", offset);

      if (nextBreak < 0) {
        return value.length;
      }

      offset = nextBreak + 1;
    }

    return offset;
  }

  function getCodeInputMetrics() {
    const style = window.getComputedStyle(codeInput);
    const fontSize = parseFloat(style.fontSize) || 13;

    return {
      lineHeight: parseFloat(style.lineHeight) || fontSize * 1.55,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0
    };
  }

  function flashLocatedCodeLine() {
    if (!codeEditor) {
      return;
    }

    if (lineLocateFlashTimer) {
      clearTimeout(lineLocateFlashTimer);
    }

    codeEditor.classList.add("line-located");
    lineLocateFlashTimer = window.setTimeout(() => {
      codeEditor.classList.remove("line-located");
      lineLocateFlashTimer = 0;
    }, 900);
  }

  function updateUndoInsertButton() {
    if (!undoInsertButton) {
      return;
    }

    const latestSnapshot = aiInsertSnapshots[aiInsertSnapshots.length - 1];
    undoInsertButton.disabled = !latestSnapshot;
    undoInsertButton.title = latestSnapshot
      ? "回退上一次" + latestSnapshot.label
      : "暂无可回退的 AI 插入";
  }

  function updateActionButtonStates() {
    if (activeAiRequest) {
      return;
    }

    const hasSuggestion = Boolean(pendingSuggestionPreview || (lastSuggestion && lastSuggestion.trim()));
    const hasSelection = getSelectionStart(codeInput) !== getSelectionEnd(codeInput);

    insertSuggestionButton.disabled = !hasSuggestion;
    if (!pendingSuggestionPreview) {
      insertSuggestionButton.title = hasSuggestion
        ? "预览建议插入位置"
        : "先点击“下一段该写什么”获取建议代码";
    }

    explainSelectionButton.disabled = !hasSelection;
    explainSelectionButton.title = hasSelection
      ? "快捷键：Ctrl/Cmd+E"
      : "先在代码框中选中要解释的代码";
  }

  function applyShortcutTitles() {
    nextButton.title = "快捷键：Ctrl/Cmd+Enter";
    checkButton.title = "快捷键：Ctrl/Cmd+Shift+Enter";
    explainSelectionButton.title = "快捷键：Ctrl/Cmd+E";
    formatCodeButton.title = "快捷键：Shift+Alt+F";
    stopAiButton.title = "停止当前 AI 请求";
  }

  function pushAiInsertSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    aiInsertSnapshots.push(snapshot);

    if (aiInsertSnapshots.length > MAX_AI_INSERT_SNAPSHOTS) {
      aiInsertSnapshots = aiInsertSnapshots.slice(aiInsertSnapshots.length - MAX_AI_INSERT_SNAPSHOTS);
    }

    updateUndoInsertButton();
  }

  async function undoLastAiInsert() {
    const snapshot = aiInsertSnapshots.pop();
    updateUndoInsertButton();

    if (!snapshot) {
      output.textContent = "暂无可撤销的 AI 插入。";
      return;
    }

    try {
      await restoreAiInsertSnapshot(snapshot);
      output.textContent = "已撤销上一次" + snapshot.label + "。";
    } catch (error) {
      aiInsertSnapshots.push(snapshot);
      updateUndoInsertButton();
      output.textContent = "撤销插入失败：" + (error.message || String(error));
    }
  }

  async function restoreAiInsertSnapshot(snapshot) {
    if (snapshot.type === "assistant-code") {
      restoreAssistantCodeSnapshot(snapshot);
      return;
    }

    if (snapshot.type === "page-input") {
      restorePageInputSnapshot(snapshot);
      return;
    }

    if (snapshot.type === "page-contenteditable") {
      restorePageContentEditableSnapshot(snapshot);
      return;
    }

    if (snapshot.type === "leetcode") {
      await restoreLeetCodeInsertSnapshot(snapshot);
      return;
    }

    throw new Error("无法识别的快照类型。");
  }

  function createAssistantCodeSnapshot(label) {
    return {
      type: "assistant-code",
      label,
      value: codeInput.value,
      selectionStart: getSelectionStart(codeInput),
      selectionEnd: getSelectionEnd(codeInput),
      scrollTop: codeInput.scrollTop,
      savedAt: Date.now()
    };
  }

  function restoreAssistantCodeSnapshot(snapshot) {
    codeInput.value = snapshot.value || "";
    codeInput.setSelectionRange(
      Math.min(snapshot.selectionStart || 0, codeInput.value.length),
      Math.min(snapshot.selectionEnd || 0, codeInput.value.length)
    );
    codeInput.scrollTop = snapshot.scrollTop || 0;
    codeInput.dispatchEvent(new Event("input", { bubbles: true }));
    codeInput.focus();
  }

  function createPageInsertSnapshot(target, label) {
    if (!isEditable(target) || shadow.contains(target)) {
      return null;
    }

    if ("value" in target) {
      return {
        type: "page-input",
        label,
        target,
        value: target.value || "",
        selectionStart: getSelectionStart(target),
        selectionEnd: getSelectionEnd(target),
        scrollTop: target.scrollTop || 0,
        pageUrl: location.href,
        savedAt: Date.now()
      };
    }

    return {
      type: "page-contenteditable",
      label,
      target,
      html: target.innerHTML,
      selection: getContentEditableSelectionOffsets(target),
      scrollTop: target.scrollTop || 0,
      pageUrl: location.href,
      savedAt: Date.now()
    };
  }

  function restorePageInputSnapshot(snapshot) {
    const target = snapshot.target;
    assertSnapshotPageStillCurrent(snapshot);
    assertSnapshotTargetAvailable(target);

    target.focus();
    target.value = snapshot.value || "";

    if (typeof target.setSelectionRange === "function") {
      try {
        const selectionStart = Math.min(snapshot.selectionStart || 0, target.value.length);
        const selectionEnd = Math.min(snapshot.selectionEnd || 0, target.value.length);
        target.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        // Some input types do not support text selection.
      }
    }

    target.scrollTop = snapshot.scrollTop || 0;
    dispatchEditableChange(target);
  }

  function restorePageContentEditableSnapshot(snapshot) {
    const target = snapshot.target;
    assertSnapshotPageStillCurrent(snapshot);
    assertSnapshotTargetAvailable(target);

    target.focus();
    target.innerHTML = snapshot.html || "";
    target.scrollTop = snapshot.scrollTop || 0;
    restoreContentEditableSelectionOffsets(target, snapshot.selection);
    dispatchEditableChange(target);
  }

  async function createLeetCodeInsertSnapshot(label) {
    const response = await sendRuntimeMessage({
      type: "CAPTURE_LEETCODE_CODE_SNAPSHOT"
    });

    return {
      type: "leetcode",
      label,
      text: response.text || "",
      method: response.method || "main-world",
      pageUrl: location.href,
      savedAt: Date.now()
    };
  }

  async function syncLeetCodeEditorTemplate(options = {}) {
    if (!isLeetCodeProblemPage()) {
      return false;
    }

    try {
      const response = await sendRuntimeMessage({
        type: "CAPTURE_LEETCODE_CODE_SNAPSHOT"
      });
      const templateCode = normalizeLeetCodeTemplateCode(response.text);
      const detectedLanguage = getAssistantLanguageFromEditor(response.languageId || response.language, templateCode);
      let changed = false;

      if (detectedLanguage && isLanguageOptionValue(detectedLanguage) && languageSelect.value !== detectedLanguage) {
        languageSelect.value = detectedLanguage;
        lastLeetCodeTemplateLanguage = detectedLanguage;
        changed = true;
      }

      if (templateCode && shouldImportLeetCodeTemplate(templateCode)) {
        codeInput.value = templateCode;
        const cursorOffset = findTemplateCursorOffset(templateCode);
        codeInput.setSelectionRange(cursorOffset, cursorOffset);
        codeInput.scrollTop = 0;
        syncCodeEditorMetrics();
        lastLeetCodeTemplateCode = templateCode;
        lastLeetCodeTemplateUrl = location.href;
        changed = true;
      }

      if (changed && options.save !== false) {
        saveDraft();
      }

      return changed;
    } catch (error) {
      if (!options.silent) {
        output.textContent = "识别 LeetCode 语言模板失败：" + (error.message || String(error));
      }

      return false;
    }
  }

  async function syncCurrentProblemPageLanguage(options = {}) {
    if (isLeetCodeProblemPage()) {
      return await syncLeetCodeEditorTemplate(options);
    }

    if (getLuoguProblemId()) {
      return syncLuoguSubmitLanguage(options);
    }

    return false;
  }

  function syncLuoguSubmitLanguage(options = {}) {
    const detectedLanguage = detectLuoguSubmitLanguage();

    if (!detectedLanguage || !isLanguageOptionValue(detectedLanguage) || languageSelect.value === detectedLanguage) {
      return false;
    }

    languageSelect.value = detectedLanguage;

    if (options.save !== false) {
      saveDraft();
    }

    return true;
  }

  function detectLuoguSubmitLanguage() {
    const candidates = collectNativeSelectLanguageCandidates()
      .concat(collectCustomLanguageCandidates())
      .map((candidate) => ({
        ...candidate,
        language: getAssistantLanguageFromLuoguText(candidate.text)
      }))
      .filter((candidate) => candidate.language);

    if (candidates.length === 0) {
      return "";
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].language;
  }

  function collectNativeSelectLanguageCandidates() {
    return Array.from(document.querySelectorAll("select"))
      .filter((node) => !shadow.contains(node) && isVisibleElement(node))
      .flatMap((select) => {
        const selectedOption = select.selectedOptions && select.selectedOptions[0];
        const selectedText = [
          selectedOption && (selectedOption.textContent || selectedOption.value),
          select.value
        ].filter(Boolean).join(" ");
        const attrs = getLanguageCandidateAttrs(select);
        const text = compactOneLine(selectedText);
        const score = scoreLanguageCandidate(attrs, text, 80);

        return text ? [{ text, score }] : [];
      });
  }

  function collectCustomLanguageCandidates() {
    const selector = [
      "[role='combobox']",
      "[role='button']",
      "[aria-haspopup='listbox']",
      "[aria-haspopup='menu']",
      "button",
      "[class*='language' i]",
      "[class*='lang' i]",
      "[class*='compiler' i]",
      "[class*='select' i]",
      "[class*='dropdown' i]"
    ].join(",");

    return Array.from(document.querySelectorAll(selector))
      .filter((node) => !shadow.contains(node) && isVisibleElement(node))
      .map((node) => {
        const attrs = getLanguageCandidateAttrs(node);
        const text = compactOneLine(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
        return {
          text,
          score: scoreLanguageCandidate(attrs, text, 0)
        };
      })
      .filter((candidate) => candidate.text && candidate.text.length <= 120 && candidate.score > 0);
  }

  function getLanguageCandidateAttrs(node) {
    if (!node) {
      return "";
    }

    return [
      node.id || "",
      typeof node.className === "string" ? node.className : "",
      node.getAttribute && node.getAttribute("name") || "",
      node.getAttribute && node.getAttribute("aria-label") || "",
      node.getAttribute && node.getAttribute("title") || "",
      node.getAttribute && node.getAttribute("placeholder") || "",
      node.getAttribute && node.getAttribute("data-vv-name") || ""
    ].join(" ").toLowerCase();
  }

  function scoreLanguageCandidate(attrs, text, baseScore) {
    const normalizedText = String(text || "");
    let score = baseScore;

    if (/(language|lang|compiler|judge|submit|code|语言|编译|提交|评测)/i.test(attrs)) {
      score += 80;
    }

    if (/(language|compiler|语言|编译器|提交语言|评测语言)/i.test(normalizedText)) {
      score += 50;
    }

    if (getAssistantLanguageFromLuoguText(normalizedText)) {
      score += 30;
    }

    if (normalizedText.length > 80) {
      score -= 40;
    }

    return score;
  }

  function compactOneLine(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getAssistantLanguageFromLuoguText(text) {
    const value = compactOneLine(text);
    const lower = value.toLowerCase();

    if (!value) {
      return "";
    }

    if (/typescript|\bts\b/.test(lower)) {
      return "typescript";
    }

    if (/javascript|node\.?js|\bjs\b/.test(lower)) {
      return "javascript";
    }

    if (/c\s*\+\+\s*20|cpp\s*20|g\+\+\s*20|clang\+\+\s*20/.test(lower)) {
      return "cpp20";
    }

    if (/c\s*\+\+\s*17|cpp\s*17|g\+\+\s*17|clang\+\+\s*17/.test(lower)) {
      return "cpp17";
    }

    if (/c\s*\+\+\s*14|cpp\s*14|g\+\+\s*14|clang\+\+\s*14/.test(lower)) {
      return "cpp14";
    }

    if (/c\s*\+\+\s*11|cpp\s*11|g\+\+\s*11|clang\+\+\s*11/.test(lower)) {
      return "cpp11";
    }

    if (/c\s*\+\+\s*(98|03)|cpp\s*(98|03)|g\+\+\s*(98|03)/.test(lower)) {
      return "cpp98";
    }

    if (/c\+\+|cpp|g\+\+|clang\+\+/.test(lower)) {
      return "cpp17";
    }

    if (/java\s*8|jdk\s*8/.test(lower)) {
      return "java8";
    }

    if (/java\s*11|jdk\s*11/.test(lower)) {
      return "java11";
    }

    if (/java\s*17|jdk\s*17/.test(lower)) {
      return "java17";
    }

    if (/\bjava\b|openjdk|jdk/.test(lower)) {
      return "java17";
    }

    if (/python|pypy|\bpy3?\b/.test(lower)) {
      return "python";
    }

    if (/c#|csharp|c-sharp/.test(lower)) {
      return "csharp";
    }

    if (/\bgolang\b|\bgo\b/.test(lower)) {
      return "go";
    }

    if (/^c(?:\s|$)|\bc\s*(?:gcc|clang|语言|lang)/.test(lower)) {
      return "c";
    }

    if (/\bhtml\b/.test(lower)) {
      return "html";
    }

    if (/\bcss\b/.test(lower)) {
      return "css";
    }

    return "";
  }

  function normalizeLeetCodeTemplateCode(text) {
    return String(text || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .trimEnd();
  }

  function shouldImportLeetCodeTemplate(templateCode) {
    const currentCode = codeInput.value;

    if (!currentCode.trim()) {
      return true;
    }

    return (lastLeetCodeTemplateUrl === location.href && currentCode === lastLeetCodeTemplateCode && currentCode !== templateCode) ||
      (currentCode !== templateCode && looksLikeEmptyLeetCodeTemplate(currentCode));
  }

  function looksLikeEmptyLeetCodeTemplate(code) {
    const text = normalizeLeetCodeTemplateCode(code);

    if (!/\bclass\s+Solution\b|\bpublic\s+class\s+Solution\b|\bvar\s+\w+\s*=\s*function\b|\bfunction\s+\w+\s*\(|\bfunc\s+\w+\s*\(/.test(text)) {
      return false;
    }

    return /[\{:]\s*\n[ \t]*\n[ \t]*(?:\}|$)/.test(text);
  }

  function getAssistantLanguageFromEditor(languageId, templateCode) {
    const normalizedLanguageId = String(languageId || "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
    const languageMap = {
      c: "c",
      cc: "cpp17",
      cxx: "cpp17",
      cpp: "cpp17",
      cpp17: "cpp17",
      cpp20: "cpp20",
      "c++": "cpp17",
      python: "python",
      python3: "python",
      py: "python",
      java: "java17",
      javascript: "javascript",
      js: "javascript",
      typescript: "typescript",
      ts: "typescript",
      csharp: "csharp",
      cs: "csharp",
      go: "go",
      golang: "go"
    };

    if (languageMap[normalizedLanguageId]) {
      return languageMap[normalizedLanguageId];
    }

    if (!templateCode) {
      return "";
    }

    return window.CodingAssistantCore && typeof window.CodingAssistantCore.detectLanguage === "function"
      ? window.CodingAssistantCore.detectLanguage(templateCode, "auto")
      : "";
  }

  function isLanguageOptionValue(value) {
    return Array.from(languageSelect.options).some((option) => option.value === value);
  }

  function findTemplateCursorOffset(code) {
    const text = String(code || "");
    const lines = text.split("\n");
    let offset = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const previousLine = lines[index - 1] || "";
      const nextLine = lines[index + 1] || "";

      if (!line.trim() && /[\{:]\s*$/.test(previousLine.trim()) && nextLine.trim()) {
        return offset + line.length;
      }

      offset += line.length + 1;
    }

    return text.length;
  }

  async function restoreLeetCodeInsertSnapshot(snapshot) {
    assertSnapshotPageStillCurrent(snapshot);

    await withAssistantOverlayHidden(() => sendRuntimeMessage({
      type: "RESTORE_LEETCODE_CODE_SNAPSHOT",
      text: snapshot.text || ""
    }));
  }

  function assertSnapshotTargetAvailable(target) {
    if (!target || !target.isConnected) {
      throw new Error("原插入位置已不存在，无法回退。");
    }
  }

  function assertSnapshotPageStillCurrent(snapshot) {
    if (snapshot.pageUrl && snapshot.pageUrl !== location.href) {
      throw new Error("页面地址已变化，已取消回退。");
    }
  }

  function dispatchEditableChange(target) {
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getSelectionStart(element) {
    return typeof element.selectionStart === "number"
      ? element.selectionStart
      : String(element.value || "").length;
  }

  function getSelectionEnd(element) {
    return typeof element.selectionEnd === "number"
      ? element.selectionEnd
      : String(element.value || "").length;
  }

  function getContentEditableSelectionOffsets(target) {
    const selection = window.getSelection && window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);

    if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) {
      return null;
    }

    return {
      start: getTextOffsetWithin(target, range.startContainer, range.startOffset),
      end: getTextOffsetWithin(target, range.endContainer, range.endOffset)
    };
  }

  function getTextOffsetWithin(root, container, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);

    try {
      range.setEnd(container, offset);
      return range.toString().length;
    } catch {
      return 0;
    }
  }

  function restoreContentEditableSelectionOffsets(target, offsets) {
    const selection = window.getSelection && window.getSelection();

    if (!selection || !document.createRange || !offsets) {
      return;
    }

    const start = findTextPosition(target, offsets.start);
    const end = findTextPosition(target, offsets.end);
    const range = document.createRange();

    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function findTextPosition(root, offset) {
    const targetOffset = Math.max(0, Number(offset) || 0);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = targetOffset;
    let lastTextNode = null;
    let node = walker.nextNode();

    while (node) {
      lastTextNode = node;
      const length = node.nodeValue.length;

      if (remaining <= length) {
        return { node, offset: remaining };
      }

      remaining -= length;
      node = walker.nextNode();
    }

    if (lastTextNode) {
      return { node: lastTextNode, offset: lastTextNode.nodeValue.length };
    }

    return { node: root, offset: root.childNodes.length };
  }

  function getEditableText(element) {
    if (!element) return "";

    if ("value" in element) {
      const start = element.selectionStart;
      const end = element.selectionEnd;

      if (typeof start === "number" && typeof end === "number" && start !== end) {
        return element.value.slice(start, end);
      }

      return element.value || "";
    }

    return element.innerText || element.textContent || "";
  }

  function getPageSelection() {
    return window.getSelection ? sanitizeText(window.getSelection().toString()) : "";
  }

  function getLuoguProblemId() {
    const match = location.href.match(/https?:\/\/(?:www\.)?luogu\.com\.cn\/problem\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  const __disabled_leetcodeMeta = String.raw`function getLeetCodeProblemSlug() {
    const match = location.href.match(/https?:\/\/(?:www\.)?(?:leetcode\.cn|leetcode\.com|leetcode-cn\.com)\/problems\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function getProblemPlatformMeta() {
    const luoguProblemId = getLuoguProblemId();

    if (luoguProblemId) {
      return {
        platform: "luogu",
        problemId: luoguProblemId,
        source: "娲涜胺椤甸潰"
      };
    }

    const leetcodeProblemSlug = getLeetCodeProblemSlug();

    if (leetcodeProblemSlug) {
      return {
        platform: "leetcode",
        problemId: leetcodeProblemSlug,
        source: "鍔涘彛椤甸潰"
      };
    }

    return {
      platform: "",
      problemId: "",
      source: ""
    };
  }`;

  function getLeetCodeProblemSlugV2() {
    const match = location.href.match(/https?:\/\/(?:www\.)?(?:leetcode\.cn|leetcode\.com|leetcode-cn\.com)\/problems\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function getProblemPlatformMetaV2() {
    const luoguProblemId = getLuoguProblemId();

    if (luoguProblemId) {
      return {
        platform: "luogu",
        problemId: luoguProblemId,
        source: "Luogu Page"
      };
    }

    const leetcodeProblemSlug = getLeetCodeProblemSlugV2();

    if (leetcodeProblemSlug) {
      return {
        platform: "leetcode",
        problemId: leetcodeProblemSlug,
        source: "LeetCode Page"
      };
    }

    return {
      platform: "",
      problemId: "",
      source: ""
    };
  }

  function extractLuoguProblemFromPage() {
    const problemId = getLuoguProblemId();

    if (!problemId) {
      return "";
    }

    const structuredProblem = extractLuoguStructuredProblemFromPage(problemId);

    if (structuredProblem) {
      return structuredProblem;
    }

    const titleNode = document.querySelector("h1") || document.querySelector("[class*='title']");
    const title = sanitizeText(titleNode && (titleNode.innerText || titleNode.textContent)) || document.title;
    const problemText = extractLuoguProblemBodyText();
    const samplesText = extractLuoguSamplesFromPage();
    const fullProblemText = samplesText ? replaceProblemSamples(problemText, samplesText) : problemText;

    return finalizeProblemText([
      "来源：洛谷页面",
      "题号：" + problemId,
      "标题：" + title.replace(/\s*-\s*洛谷.*$/, ""),
      "页面地址：" + location.href,
      "",
      fullProblemText
    ].filter(Boolean).join("\n")).slice(0, PROBLEM_TEXT_LIMIT);
  }

  function extractLuoguStructuredProblemFromPage(problemId) {
    const injection = extractLuoguInjectionFromPage();
    const problem = findLuoguProblemNode(injection);

    if (!problem) {
      return "";
    }

    const title = sanitizeText(problem.title || problem.name || document.title)
      .replace(/\s*-\s*洛谷.*$/, "");
    const sections = [
      "来源：洛谷页面",
      "题号：" + (problem.pid || problem.problemId || problemId),
      title ? "标题：" + title : "",
      "页面地址：" + location.href,
      formatLuoguSection("题目背景", problem.background),
      formatLuoguSection("题目描述", problem.description || problem.content),
      formatLuoguSection("输入格式", problem.inputFormat),
      formatLuoguSection("输出格式", problem.outputFormat),
      formatLuoguSamples(getLuoguProblemSamples(problem)) || extractLuoguSamplesFromPage(),
      formatLuoguSection("说明/提示", problem.hint),
      formatLuoguLimits(problem.limits || problem.limit)
    ];

    return finalizeProblemText(sections.filter(Boolean).join("\n\n")).slice(0, PROBLEM_TEXT_LIMIT);
  }

  function extractLuoguInjectionFromPage() {
    const scriptTexts = Array.from(document.scripts || [])
      .map((script) => script.textContent || "")
      .filter((text) => text.includes("_feInjection"));
    const pageText = scriptTexts.join("\n");

    if (!pageText) {
      return null;
    }

    const encodedMatch = pageText.match(/_feInjection\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/);

    if (encodedMatch) {
      try {
        return JSON.parse(decodeURIComponent(encodedMatch[1]));
      } catch {
        return null;
      }
    }

    const markerIndex = pageText.indexOf("_feInjection");
    const objectStart = pageText.indexOf("{", markerIndex);
    const objectText = extractBalancedJsonObjectFromText(pageText, objectStart);

    if (!objectText) {
      return null;
    }

    try {
      return JSON.parse(objectText);
    } catch {
      return null;
    }
  }

  function extractBalancedJsonObjectFromText(text, startIndex) {
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

  function formatLuoguSection(title, content) {
    const text = stringifyLuoguMarkdown(content);
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

  function formatLuoguSamples(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
      return "";
    }

    const lines = ["输入输出样例："];

    samples.forEach((sample, index) => {
      const input = stringifyLuoguSampleText(sample && (sample.input || sample[0] || ""));
      const output = stringifyLuoguSampleText(sample && (sample.output || sample[1] || ""));
      lines.push("", "输入 #" + (index + 1), input || "空", "输出 #" + (index + 1), output || "空");
    });

    return lines.join("\n");
  }

  function formatLuoguLimits(limits) {
    if (!limits) {
      return "";
    }

    if (typeof limits === "string") {
      return formatLuoguSection("限制", limits);
    }

    try {
      return "限制：\n" + JSON.stringify(limits);
    } catch {
      return "";
    }
  }

  function stringifyLuoguMarkdown(value) {
    if (value === null || typeof value === "undefined") {
      return "";
    }

    if (Array.isArray(value)) {
      return value.map(stringifyLuoguMarkdown).filter(Boolean).join("\n");
    }

    if (typeof value === "object") {
      return Object.values(value).map(stringifyLuoguMarkdown).filter(Boolean).join("\n");
    }

    return cleanProblemText(htmlToPlainText(decodeHtmlEntities(String(value))));
  }

  function stringifyLuoguSampleText(value) {
    if (value === null || typeof value === "undefined") {
      return "";
    }

    if (Array.isArray(value)) {
      return value.map(stringifyLuoguSampleText).join("\n");
    }

    return normalizeMathText(htmlToPlainText(decodeHtmlEntities(String(value))))
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
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function htmlToPlainText(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|tr|h[1-6]|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n");
  }

  function decodeHtmlEntities(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value || "");
    return textarea.value;
  }

  const __disabled_extractLeetCodeProblem = String.raw`function extractLeetCodeProblemFromPage() {
    const problemSlug = getLeetCodeProblemSlug();

    if (!problemSlug) {
      return "";
    }

    const titleNode = document.querySelector("meta[property='og:title']") ||
      document.querySelector("h1") ||
      document.querySelector("[class*='title']");
    const rawTitle = titleNode
      ? (titleNode.getAttribute && titleNode.getAttribute("content")) || titleNode.innerText || titleNode.textContent
      : document.title;
    const title = sanitizeText(rawTitle)
      .replace(/\s*-\s*(?:LeetCode|鍔涘彛.*)$/i, "");
    const roots = [
      document.querySelector("[data-track-load='description_content']"),
      document.querySelector("[class*='description']"),
      document.querySelector("article"),
      document.querySelector("main"),
      document.body
    ].filter(Boolean);
    let body = "";

    for (const root of roots) {
      const text = sliceLeetCodeProblemText(cleanProblemText(getVisibleText(root)), title, problemSlug);

      if (text.length > 120) {
        body = text;
        break;
      }
    }

    if (!body) {
      return "";
    }

    return finalizeProblemText([
      "鏉ユ簮锛氬姏鎵ｉ〉闈?",
      "棰樺彿锛? + problemSlug,
      title ? "鏍囬锛? + title : "",
      "椤甸潰鍦板潃锛? + location.href,
      "",
      "棰樼洰鎻忚堪锛?",
      "",
      body
    ].filter(Boolean).join("\n")).slice(0, PROBLEM_TEXT_LIMIT);
  }`;

  function extractLeetCodeProblemFromPageV2() {
    const problemSlug = getLeetCodeProblemSlugV2();

    if (!problemSlug) {
      return "";
    }

    const titleNode = document.querySelector("meta[property='og:title']") ||
      document.querySelector("h1") ||
      document.querySelector("[class*='title']");
    const rawTitle = titleNode
      ? (titleNode.getAttribute && titleNode.getAttribute("content")) || titleNode.innerText || titleNode.textContent
      : document.title;
    const title = sanitizeText(rawTitle)
      .replace(/\s*-\s*(?:LeetCode|.*leetcode.*)$/i, "");
    const roots = [
      document.querySelector("[data-track-load='description_content']"),
      document.querySelector("[class*='description']"),
      document.querySelector("article"),
      document.querySelector("main"),
      document.body
    ].filter(Boolean);
    let body = "";

    for (const root of roots) {
      const text = sliceLeetCodeProblemTextV2(cleanProblemText(getVisibleText(root)), title, problemSlug);

      if (text.length > 120) {
        body = text;
        break;
      }
    }

    if (!body) {
      return "";
    }

    return finalizeProblemText([
      "Source: LeetCode Page",
      "Problem ID: " + problemSlug,
      title ? "Title: " + title : "",
      "URL: " + location.href,
      "",
      "Description",
      "",
      body
    ].filter(Boolean).join("\n")).slice(0, PROBLEM_TEXT_LIMIT);
  }

  function replaceProblemSamples(problemText, samplesText) {
    const text = String(problemText || "");
    const sampleStart = text.search(/(?:输入输出样例|样例\s*\d*\s*输入|输入\s*#\s*\d+)/);

    if (sampleStart < 0) {
      return [text, samplesText].filter(Boolean).join("\n\n");
    }

    const rest = text.slice(sampleStart);
    const hintIndex = rest.search(/(?:说明\/提示|说明|提示|数据规模与约定|数据范围)/);

    if (hintIndex < 0) {
      return [text.slice(0, sampleStart).trim(), samplesText].filter(Boolean).join("\n\n");
    }

    return [
      text.slice(0, sampleStart).trim(),
      samplesText,
      rest.slice(hintIndex).trim()
    ].filter(Boolean).join("\n\n");
  }

  function extractLuoguSamplesFromPage() {
    const sampleRoots = Array.from(document.querySelectorAll("[class*='sample'], [id*='sample']"))
      .filter((node) => !isNoiseElement(node));
    const samples = [];

    for (const root of sampleRoots) {
      const preNodes = Array.from(root.querySelectorAll("pre"));

      if (preNodes.length >= 2) {
        for (let index = 0; index + 1 < preNodes.length; index += 2) {
          samples.push({
            input: getPreText(preNodes[index]),
            output: getPreText(preNodes[index + 1])
          });
        }
      }
    }

    if (samples.length === 0) {
      const labels = Array.from(document.querySelectorAll("h3, h4, strong, b, span, div"))
        .filter((node) => /^(输入|输出)\s*#\s*\d+[:：]?$/.test((node.innerText || node.textContent || "").trim()));

      for (let index = 0; index < labels.length; index += 1) {
        const labelText = (labels[index].innerText || labels[index].textContent || "").trim();

        if (!/^输入\s*#\s*\d+[:：]?$/.test(labelText)) {
          continue;
        }

        const outputLabel = labels.slice(index + 1).find((node) => /^输出\s*#\s*\d+[:：]?$/.test((node.innerText || node.textContent || "").trim()));
        const inputPre = findNearbyPre(labels[index]);
        const outputPre = outputLabel ? findNearbyPre(outputLabel) : null;

        if (inputPre && outputPre) {
          samples.push({
            input: getPreText(inputPre),
            output: getPreText(outputPre)
          });
        }
      }
    }

    if (samples.length === 0) {
      return "";
    }

    const lines = ["输入输出样例"];

    samples.forEach((sample, index) => {
      lines.push("", "输入 #" + (index + 1), sample.input || "空", "输出 #" + (index + 1), sample.output || "空");
    });

    return lines.join("\n");
  }

  function findNearbyPre(node) {
    let current = node;

    for (let depth = 0; current && depth < 4; depth += 1) {
      const siblingPre = current.nextElementSibling && current.nextElementSibling.matches("pre")
        ? current.nextElementSibling
        : null;

      if (siblingPre) {
        return siblingPre;
      }

      const localPre = current.parentElement && current.parentElement.querySelector("pre");

      if (localPre) {
        return localPre;
      }

      current = current.parentElement;
    }

    return null;
  }

  function getPreText(node) {
    return String((node && (node.innerText || node.textContent)) || "")
      .replace(/\r/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function extractLuoguProblemBodyText() {
    const roots = [
      document.querySelector("article"),
      document.querySelector("main"),
      document.querySelector("[class*='problem']"),
      document.querySelector("[class*='markdown']"),
      document.body
    ].filter(Boolean);

    for (const root of roots) {
      const text = sliceLuoguProblemText(cleanProblemText(getVisibleText(root)));

      if (text.length > 80) {
        return text;
      }
    }

    return sliceLuoguProblemText(cleanProblemText(document.body && document.body.innerText));
  }

  function getVisibleText(root) {
    if (!root || typeof root.cloneNode !== "function") {
      return "";
    }

    const clone = root.cloneNode(true);
    clone.querySelectorAll("script, style, nav, header, footer, aside, iframe, canvas, button, svg, noscript, textarea, input, select").forEach((node) => {
      node.remove();
    });
    clone.querySelectorAll("[hidden]").forEach((node) => {
      node.remove();
    });
    clone.querySelectorAll("[aria-hidden='true']").forEach((node) => {
      if (!isMathContentElement(node)) {
        node.remove();
      }
    });
    clone.querySelectorAll("[style*='display: none'], [style*='display:none'], [style*='visibility: hidden'], [style*='visibility:hidden']").forEach((node) => {
      node.remove();
    });
    clone.querySelectorAll([
      "[id*='advert' i]",
      "[class*='advert' i]",
      "[id*='banner' i]",
      "[class*='banner' i]",
      "[id*='sponsor' i]",
      "[class*='sponsor' i]",
      "[id*='promo' i]",
      "[class*='promo' i]",
      "[id*='recommend' i]",
      "[class*='recommend' i]",
      "[id*='sidebar' i]",
      "[class*='sidebar' i]",
      "[id*='comment' i]",
      "[class*='comment' i]",
      "[id*='discuss' i]",
      "[class*='discuss' i]",
      "[id*='share' i]",
      "[class*='share' i]",
      "[id*='login' i]",
      "[class*='login' i]",
      "[id*='modal' i]",
      "[class*='modal' i]",
      "[id*='popup' i]",
      "[class*='popup' i]"
    ].join(",")).forEach((node) => {
      node.remove();
    });
    clone.querySelectorAll("*").forEach((node) => {
      if (isNoiseElement(node)) {
        node.remove();
      }
    });

    return clone.innerText || clone.textContent || "";
  }

  function isNoiseElement(node) {
    const attrs = [
      node.id || "",
      typeof node.className === "string" ? node.className : "",
      node.getAttribute && node.getAttribute("role") || "",
      node.getAttribute && node.getAttribute("aria-label") || "",
      node.getAttribute && node.getAttribute("data-testid") || ""
    ].join(" ").toLowerCase();

    if (!attrs) {
      return false;
    }

    return /(^|[\s_-])ads?($|[\s_-])/.test(attrs) ||
      /(advert|advertisement|banner|sponsor|sponsored|promo|promotion|recommend|sidebar|comment|discuss|share|login|modal|popup|qrcode|wechat|weixin)/.test(attrs);
  }

  function isMathContentElement(node) {
    const attrs = [
      node.id || "",
      typeof node.className === "string" ? node.className : "",
      node.getAttribute && node.getAttribute("aria-label") || ""
    ].join(" ").toLowerCase();

    return /(katex|mathjax|math|mord|mrel|mopen|mclose|mfrac|msupsub|mspace|mop|strut)/.test(attrs) ||
      Boolean(node.closest && node.closest(".katex, .MathJax, .math"));
  }

  function sliceLuoguProblemText(text) {
    const value = String(text || "");
    const startMarkers = ["题目背景", "题目描述", "输入格式", "输出格式"];
    const endMarkers = ["题目提供者", "加入题单", "提交记录", "题解", "讨论", "相关题目", "推荐题目", "登录后可提交"];
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

  const __disabled_sliceLeetCodeProblemText = String.raw`function sliceLeetCodeProblemText(text, title, problemSlug) {
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

  function cleanProblemText(value) {
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
      .filter((line) => line && !isProblemNoiseLine(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return finalizeProblemText(text);
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

  function isProblemNoiseLine(line) {
    const value = String(line || "").trim();
    const lower = value.toLowerCase();

    if (isProblemAdLine(value, lower)) {
      return true;
    }

    if (/^(复制|提交|保存|取消|展开|收起|返回|登录|注册|分享|关注|举报|收藏|点赞|评论|回复)$/.test(value)) {
      return true;
    }

    if (isUsefulProblemHintLine(value)) {
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

  function isProblemAdLine(value, lower) {
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

  function isUsefulProblemHintLine(value) {
    return /(数据规模|约定|保证|范围|限制|提示|说明|样例解释|输入|输出|测试点|特殊|注意|其中|对于全部|对于.*测试点|时间限制|空间限制|0\s*[<≤]|[<≤]\s*\d|复杂度)/.test(value);
  }

  function finalizeProblemText(text) {
    const protectedLinks = [];
    const sectionedText = normalizeProblemSections(removeEmptyHintSections(text));
    const preparedText = protectInlineMetaAndNoteLinks(sectionedText, protectedLinks);

    return normalizeSampleValues(restoreProtectedLinks(moveLinksToEnd(preparedText), protectedLinks))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeSampleValues(text) {
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

  function normalizeProblemSections(text) {
    const lines = explodeProblemLines(String(text || ""))
      .split("\n")
      .map((line) => line.trimEnd());
    const nextLines = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (/^[:：]$/.test(line)) {
        continue;
      }

      if (!line) {
        pushBlankLine(nextLines);
        continue;
      }

      const inlineSection = splitInlineProblemSection(line);

      if (inlineSection) {
        pushBlankLine(nextLines);
        nextLines.push(inlineSection.heading);
        pushBlankLine(nextLines);
        if (inlineSection.content) {
          nextLines.push(inlineSection.content);
        }
        continue;
      }

      if (isProblemSectionHeading(line) || isSampleBlockHeading(line)) {
        pushBlankLine(nextLines);
        nextLines.push(normalizeProblemHeading(line));
        pushBlankLine(nextLines);
        continue;
      }

      nextLines.push(rawLine);
    }

    return nextLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function pushBlankLine(lines) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
  }

  function isProblemSectionHeading(line) {
    return /^(题目背景|题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示|数据规模与约定|数据范围|限制)[:：]?$/.test(line) ||
      isSampleExplanationHeading(line);
  }

  function isSampleBlockHeading(line) {
    return /^(样例\s*\d*\s*(?:输入|输出)|(?:输入|输出)\s*#\s*\d+)[:：]?$/.test(line);
  }

  function explodeProblemLines(text) {
    return String(text || "")
      .split("\n")
      .flatMap((line) => splitProblemLineByHeadings(line))
      .join("\n");
  }

  function splitProblemLineByHeadings(line) {
    const sampleExplanationParts = splitSampleExplanationLine(line);

    if (sampleExplanationParts) {
      return sampleExplanationParts;
    }

    const parts = [];
    let remaining = String(line || "").trimEnd();

    while (remaining) {
      const match = findNextProblemHeading(remaining);

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

  function findNextProblemHeading(line) {
    const headingPattern = /(题目背景|题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示|数据规模与约定|数据范围|限制|样例\s*\d*\s*(?:输入|输出)|(?:输入|输出)\s*#\s*\d+)/g;
    let result = null;

    for (const match of String(line || "").matchAll(headingPattern)) {
      const index = match.index || 0;
      const heading = match[1];

      if (isHeadingInsideBracketedText(line, index, heading)) {
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

  function splitInlineProblemSection(line) {
    const sampleExplanationMatch = String(line || "").match(/^[【\[]?\s*(样例\s*\d+\s*(?:说明|解释))\s*[】\]]?[:：]?\s+(.+)$/);

    if (sampleExplanationMatch) {
      return {
        heading: normalizeProblemHeading(sampleExplanationMatch[1]),
        content: sampleExplanationMatch[2] || ""
      };
    }

    const match = String(line || "").match(/^(题目背景|题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示|数据规模与约定|数据范围|限制|样例\s*\d*\s*(?:输入|输出)|(?:输入|输出)\s*#\s*\d+)[:：]?\s+(.+)$/);

    if (!match) {
      return null;
    }

    return {
      heading: normalizeProblemHeading(match[1]),
      content: match[2] || ""
    };
  }

  function normalizeProblemHeading(line) {
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

  function splitSampleExplanationLine(line) {
    const match = String(line || "").match(/^([【\[]?\s*样例\s*\d+\s*(?:说明|解释)\s*[】\]]?[:：]?)(?:\s+(.+))?$/);

    if (!match) {
      return null;
    }

    return [match[1], match[2]].filter(Boolean);
  }

  function isSampleExplanationHeading(line) {
    return /^[【\[]?\s*样例\s*\d+\s*(?:说明|解释)\s*[】\]]?[:：]?$/.test(String(line || "").trim());
  }

  function isHeadingInsideBracketedText(line, index, heading) {
    const before = String(line || "").slice(0, index);
    const after = String(line || "").slice(index + String(heading || "").length);
    const chineseOpen = before.lastIndexOf("【");
    const chineseClose = before.lastIndexOf("】");
    const squareOpen = before.lastIndexOf("[");
    const squareClose = before.lastIndexOf("]");

    return (chineseOpen > chineseClose && after.includes("】")) ||
      (squareOpen > squareClose && after.includes("]"));
  }

  function protectInlineMetaAndNoteLinks(text, protectedLinks) {
    return String(text || "")
      .split("\n")
      .map((line) => {
        if (!shouldProtectInlineLinks(line)) {
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

  function shouldProtectInlineLinks(line) {
    const value = String(line || "").trim();
    return /^([^：:]{0,12}地址|URL|Url|url)[:：]\s*https?:\/\//.test(value) ||
      /^(\*\*)?\[链接\d+\](\*\*)?/.test(value) ||
      /^(\*\*)?链接注释(\*\*)?[:：]/.test(value);
  }

  function restoreProtectedLinks(text, protectedLinks) {
    return String(text || "").replace(/__CODING_ASSISTANT_INLINE_URL_(\d+)__/g, (_, index) => {
      return protectedLinks[Number(index)] || "";
    });
  }

  function removeEmptyHintSections(text) {
    const lines = String(text || "").split("\n");
    const nextLines = [];

    for (let index = 0; index < lines.length;) {
      const line = lines[index].trim();

      if (!isHintSectionHeading(line)) {
        nextLines.push(lines[index]);
        index += 1;
        continue;
      }

      const sectionEnd = findNextTopLevelSectionIndex(lines, index + 1);
      const sectionLines = lines
        .slice(index + 1, sectionEnd)
        .map((item) => item.trim())
        .filter(Boolean);

      if (sectionLines.length === 0 || sectionLines.every((item) => isProblemNoiseLine(item))) {
        index = sectionEnd;
        continue;
      }

      nextLines.push(lines[index]);
      index += 1;
    }

    return nextLines.join("\n").trim();
  }

  function isHintSectionHeading(line) {
    return /^(说明\/提示|说明|提示)[:：]?$/.test(line);
  }

  function findNextTopLevelSectionIndex(lines, startIndex) {
    for (let index = startIndex; index < lines.length; index += 1) {
      if (isTopLevelProblemSection(lines[index].trim())) {
        return index;
      }
    }

    return lines.length;
  }

  function isTopLevelProblemSection(line) {
    return /^(题目背景|题目描述|输入格式|输出格式|输入输出样例|样例|样例输入|样例输出)[:：]?$/.test(line);
  }

  function moveLinksToEnd(text) {
    const notes = [];
    let nextText = String(text || "");

    nextText = nextText.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
      return createLinkMarker(notes, label || "图片", url);
    });

    nextText = nextText.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
      return createLinkMarker(notes, label, url);
    });

    nextText = nextText.replace(/(^|[\s（(:：])((?:https?:\/\/)[^\s）)]+)(?=$|[\s）)])/g, (match, prefix, url) => {
      return prefix + createLinkMarker(notes, "链接", url);
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

  function createLinkMarker(notes, label, url) {
    const cleanLabel = String(label || "链接").replace(/\s+/g, " ").trim();
    const cleanUrl = String(url || "").replace(/[.,;，。；]+$/g, "");
    const combined = cleanLabel + " " + cleanUrl;

    if (isImageLinkLabel(cleanLabel) || isImageUrl(cleanUrl)) {
      return "";
    }

    if (isProblemAdLine(combined, combined.toLowerCase())) {
      return cleanLabel === "链接" ? "" : cleanLabel;
    }

    notes.push({
      label: cleanLabel,
      url: cleanUrl
    });

    return cleanLabel + "**[链接" + notes.length + "]**";
  }

  function isImageLinkLabel(label) {
    return label === "图片" ||
      /^!\[/.test(label) ||
      /https?:\/\/[^\s)]+\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(label) ||
      /image_hosting/i.test(label);
  }

  function isImageUrl(url) {
    return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) || /image_hosting/i.test(url);
  }

  function collectPageText() {
    const selection = getPageSelection();

    if (selection.length > 80) {
      return selection;
    }

    const luoguProblem = extractLuoguProblemFromPage();

    if (luoguProblem) {
      return luoguProblem;
    }

    const leetcodeProblem = extractLeetCodeProblemFromPageV2();

    if (leetcodeProblem) {
      return leetcodeProblem;
    }

    const selectors = [
      "main",
      "article",
      "[class*='problem']",
      "[class*='question']",
      "[id*='problem']",
      "[id*='question']",
      ".content",
      "#content"
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = cleanProblemText(getVisibleText(element));

      if (text.length > 120) {
        return text.slice(0, PROBLEM_TEXT_LIMIT);
      }
    }

    return cleanProblemText(getVisibleText(document.body)).slice(0, PROBLEM_TEXT_LIMIT);
  }

  const __disabled_getPagePayloadV2 = String.raw`function getPagePayloadV2() {
    const platformMeta = getProblemPlatformMeta();

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      pageText: collectPageText(),
      selection: getPageSelection(),
      code: codeInput.value,
      language: languageSelect.value,
      platform: platformMeta.platform,
      problemId: platformMeta.problemId
    };
  }`;

  function getPagePayloadV3() {
    const platformMeta = getProblemPlatformMetaV2();

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      pageText: collectPageText(),
      selection: getPageSelection(),
      code: codeInput.value,
      language: languageSelect.value,
      platform: platformMeta.platform,
      problemId: platformMeta.problemId
    };
  }

  function getPagePayload() {
    const luoguProblemId = getLuoguProblemId();

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      pageText: collectPageText(),
      selection: getPageSelection(),
      code: codeInput.value,
      language: languageSelect.value,
      platform: luoguProblemId ? "luogu" : "",
      problemId: luoguProblemId
    };
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextAvailable() || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(createExtensionContextError());
        return;
      }

      try {
        chrome.runtime.sendMessage(message, (response) => {
          const lastError = getRuntimeLastErrorMessage();

          if (lastError) {
            reject(new Error(lastError));
            return;
          }

          if (!response || !response.ok) {
            reject(new Error(response && response.error ? response.error : "请求失败"));
            return;
          }

          resolve(response);
        });
      } catch (error) {
        reject(error && /Extension context invalidated/i.test(error.message || "")
          ? createExtensionContextError()
          : error);
      }
    });
  }

  async function syncProblemContext() {
    syncButton.disabled = true;
    statusText.textContent = (isLeetCodeProblemPage() || getLuoguProblemId()) ? "题目上下文：正在识别页面语言" : "题目上下文：正在同步";

    try {
      await syncCurrentProblemPageLanguage({ silent: true, save: false });
      statusText.textContent = "题目上下文：正在同步";

      const response = await sendRuntimeMessage({
        type: "FETCH_PROBLEM_CONTEXT",
        payload: getPagePayloadV3()
      });

      const problem = window.CodingAssistantCore.normalizeProblemPayload(response.problem || response.data);
      lastProblemContext = problem || buildLocalProblemContextV3();
      lastServerSource = response.source || (response.fromServer ? "服务器" : "页面");
      problemInput.value = lastProblemContext;
      statusText.textContent = "题目上下文：已同步 " + lastProblemContext.length + " 字";
      sourceText.textContent = "来源：" + lastServerSource;
      saveDraft();
    } catch (error) {
      lastProblemContext = buildLocalProblemContextV3();
      problemInput.value = lastProblemContext;
      statusText.textContent = "题目上下文：服务器失败，已使用页面内容";
      sourceText.textContent = "来源：页面内容";
      output.textContent = "同步服务器失败：" + (error.message || String(error)) + "\n\n已回退为当前网页正文。";
    } finally {
      syncButton.disabled = false;
    }
  }

  async function openExternalEditor(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (externalEditorButton) {
      externalEditorButton.disabled = true;
    }

    try {
      await saveDraft({ recordHistory: true, label: "打开独立窗口前" });
      await sendRuntimeMessage({
        type: "OPEN_EXTERNAL_EDITOR",
        payload: getPagePayloadV3()
      });
      setPanelOpen(false);
    } catch (error) {
      output.textContent = "打开独立窗口失败：" + (error.message || String(error));
    } finally {
      if (externalEditorButton) {
        externalEditorButton.disabled = false;
      }
    }
  }

  const __disabled_buildLocalProblemContextV2 = String.raw`function buildLocalProblemContextV2() {
    const platformMeta = getProblemPlatformMeta();
    const pageText = collectPageText();

    if (isStructuredProblemText(pageText)) {
      return pageText.slice(0, PROBLEM_TEXT_LIMIT);
    }

    const pieces = [
      platformMeta.source ? "鏉ユ簮锛? + platformMeta.source : "",
      platformMeta.problemId ? "棰樺彿锛? + platformMeta.problemId : "",
      "椤甸潰鏍囬锛? + document.title,
      "椤甸潰鍦板潃锛? + location.href,
      "",
      pageText
    ];

    return finalizeProblemText(pieces.filter(Boolean).join("\n")).slice(0, PROBLEM_TEXT_LIMIT);
  }`;

  function buildLocalProblemContextV3() {
    const platformMeta = getProblemPlatformMetaV2();
    const pageText = collectPageText();

    if (isStructuredProblemText(pageText)) {
      return pageText.slice(0, PROBLEM_TEXT_LIMIT);
    }

    const pieces = [
      platformMeta.source ? "Source: " + platformMeta.source : "",
      platformMeta.problemId ? "Problem ID: " + platformMeta.problemId : "",
      "Page Title: " + document.title,
      "Page URL: " + location.href,
      "",
      pageText
    ];

    return finalizeProblemText(pieces.filter(Boolean).join("\n")).slice(0, PROBLEM_TEXT_LIMIT);
  }

  function buildLocalProblemContext() {
    const luoguProblemId = getLuoguProblemId();
    const pageText = collectPageText();

    if (isStructuredProblemText(pageText)) {
      return pageText.slice(0, PROBLEM_TEXT_LIMIT);
    }

    const pieces = [
      luoguProblemId ? "来源：洛谷页面" : "",
      luoguProblemId ? "题号：" + luoguProblemId : "",
      "页面标题：" + document.title,
      "页面地址：" + location.href,
      "",
      pageText
    ];

    return finalizeProblemText(pieces.filter(Boolean).join("\n")).slice(0, PROBLEM_TEXT_LIMIT);
  }

  function isStructuredProblemText(text) {
    const value = String(text || "").trim();

    if (!value) {
      return false;
    }

    const firstChunk = value.slice(0, 400);
    if (/(Source:|Problem ID:|Title:|URL:|Page Title:|Page URL:)/.test(firstChunk) &&
      /(Description|Input|Output|Example|Hints|Constraints)/.test(value)) {
      return true;
    }
    return /(来源：|题号：|标题：|页面地址：)/.test(firstChunk) &&
      /(题目描述|输入格式|输出格式|输入输出样例|说明\/提示|说明|提示)/.test(value);
  }

  function buildSuggestionScopeDetails(code, cursorOffset) {
    const scope = getSelectedSuggestionScope();
    const config = SUGGESTION_SCOPE_CONFIG[scope] || SUGGESTION_SCOPE_CONFIG.small;
    const language = getFormattingLanguage(code);
    let context = "";

    if (scope === "function") {
      context = extractFunctionScopeContext(code, cursorOffset, language);
    } else if (scope === "block") {
      context = extractBlockScopeContext(code, cursorOffset, language);
    }

    if (!context) {
      context = extractCursorWindowContext(code, cursorOffset, scope === "small" ? 5 : 8, scope === "small" ? 5 : 8);
    }

    return {
      scope,
      label: config.label,
      note: config.note,
      instruction: config.instruction,
      context
    };
  }

  function extractCursorWindowContext(code, cursorOffset, beforeCount, afterCount) {
    const lineInfo = getCodeLineInfo(code);
    const lineIndex = getLineIndexAtOffset(lineInfo, cursorOffset);
    const startLine = Math.max(0, lineIndex - beforeCount);
    const endLine = Math.min(lineInfo.lines.length - 1, lineIndex + afterCount);
    return extractCodeByLineRange(lineInfo, startLine, endLine);
  }

  function extractBlockScopeContext(code, cursorOffset, language) {
    if (language === "python") {
      return extractPythonIndentedScope(code, cursorOffset, /^(if|elif|else|for|while|try|except|finally|with|match|case|def|class)\b/);
    }

    const stack = findEnclosingBraceStack(code, cursorOffset);

    if (!stack.length) {
      return "";
    }

    const openIndex = stack[stack.length - 1];
    const closeIndex = findMatchingClosingBrace(code, openIndex);

    if (closeIndex < 0) {
      return "";
    }

    const startIndex = findStatementStart(code, openIndex);
    return extractCodeByOffsets(code, startIndex, closeIndex + 1);
  }

  function extractFunctionScopeContext(code, cursorOffset, language) {
    if (language === "python") {
      return extractPythonIndentedScope(code, cursorOffset, /^(async\s+def|def)\b/);
    }

    const stack = findEnclosingBraceStack(code, cursorOffset);

    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const openIndex = stack[index];
      const startIndex = findStatementStart(code, openIndex);
      const header = code.slice(startIndex, openIndex + 1);

      if (!looksLikeFunctionHeader(header, language)) {
        continue;
      }

      const closeIndex = findMatchingClosingBrace(code, openIndex);

      if (closeIndex >= 0) {
        return extractCodeByOffsets(code, startIndex, closeIndex + 1);
      }
    }

    return "";
  }

  function extractPythonIndentedScope(code, cursorOffset, headerPattern) {
    const lineInfo = getCodeLineInfo(code);
    const anchorLine = getNearestNonEmptyLineIndex(lineInfo.lines, getLineIndexAtOffset(lineInfo, cursorOffset));

    if (anchorLine < 0) {
      return "";
    }

    const anchorIndent = getIndentWidth(lineInfo.lines[anchorLine]);

    for (let index = anchorLine; index >= 0; index -= 1) {
      const trimmed = lineInfo.lines[index].trim();

      if (!trimmed || !trimmed.endsWith(":")) {
        continue;
      }

      const normalized = trimmed.replace(/^async\s+/, "");

      if (!headerPattern.test(normalized)) {
        continue;
      }

      const headerIndent = getIndentWidth(lineInfo.lines[index]);

      if (headerIndent > anchorIndent) {
        continue;
      }

      let startLine = index;

      while (startLine > 0 && /^\s*@/.test(lineInfo.lines[startLine - 1])) {
        startLine -= 1;
      }

      const endLine = findPythonScopeEndLine(lineInfo.lines, index, headerIndent);
      return extractCodeByLineRange(lineInfo, startLine, endLine);
    }

    return "";
  }

  function findPythonScopeEndLine(lines, headerLineIndex, headerIndent) {
    let endLine = lines.length - 1;

    for (let index = headerLineIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      if (getIndentWidth(line) <= headerIndent) {
        endLine = index - 1;
        break;
      }
    }

    return Math.max(headerLineIndex, endLine);
  }

  function getCodeLineInfo(code) {
    const lines = normalizeCodeForFormatting(code).split("\n");
    const lineStarts = [];
    let offset = 0;

    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }

    return { lines, lineStarts };
  }

  function getLineIndexAtOffset(lineInfo, offset) {
    const clampedOffset = Math.max(0, Math.min(offset, normalizeCodeForFormatting(lineInfo.lines.join("\n")).length));

    for (let index = lineInfo.lineStarts.length - 1; index >= 0; index -= 1) {
      if (lineInfo.lineStarts[index] <= clampedOffset) {
        return index;
      }
    }

    return 0;
  }

  function getNearestNonEmptyLineIndex(lines, startIndex) {
    for (let index = startIndex; index >= 0; index -= 1) {
      if (String(lines[index] || "").trim()) {
        return index;
      }
    }

    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (String(lines[index] || "").trim()) {
        return index;
      }
    }

    return -1;
  }

  function extractCodeByLineRange(lineInfo, startLine, endLine) {
    if (!lineInfo.lines.length) {
      return "";
    }

    const safeStart = Math.max(0, Math.min(startLine, lineInfo.lines.length - 1));
    const safeEnd = Math.max(safeStart, Math.min(endLine, lineInfo.lines.length - 1));
    return stripCodeEdgeBlankLines(lineInfo.lines.slice(safeStart, safeEnd + 1).join("\n"));
  }

  function extractCodeByOffsets(code, startOffset, endOffset) {
    return stripCodeEdgeBlankLines(normalizeCodeForFormatting(code).slice(
      Math.max(0, startOffset),
      Math.max(Math.max(0, startOffset), endOffset)
    ));
  }

  function findEnclosingBraceStack(code, cursorOffset) {
    const stack = [];

    iterateStructuralCode(code, 0, Math.max(0, cursorOffset), (char, index) => {
      if (char === "{") {
        stack.push(index);
      } else if (char === "}" && stack.length > 0) {
        stack.pop();
      }
    });

    return stack;
  }

  function findMatchingClosingBrace(code, openIndex) {
    let depth = 0;
    let foundIndex = -1;

    iterateStructuralCode(code, openIndex, code.length, (char, index) => {
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;

        if (depth === 0) {
          foundIndex = index;
          return false;
        }
      }

      return true;
    });

    return foundIndex;
  }

  function iterateStructuralCode(code, startOffset, endOffset, visitor) {
    const text = normalizeCodeForFormatting(code);
    let inBlockComment = false;
    let inLineComment = false;
    let quote = "";
    let escaped = false;

    for (let index = Math.max(0, startOffset); index < Math.min(text.length, endOffset); index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (inLineComment) {
        if (char === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === "/" && next === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (char === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      if (visitor(char, index) === false) {
        return;
      }
    }
  }

  function findStatementStart(code, braceIndex) {
    const text = normalizeCodeForFormatting(code);
    let lineStart = text.lastIndexOf("\n", braceIndex - 1) + 1;
    let start = lineStart;

    while (start > 0) {
      const previousLineEnd = start - 1;
      const previousLineStart = text.lastIndexOf("\n", previousLineEnd - 1) + 1;
      const previousLine = text.slice(previousLineStart, previousLineEnd).trimEnd();

      if (!previousLine) {
        break;
      }

      if (/[,(\\]$/.test(previousLine) || /^\s*(template\s*<|@\w+)/.test(previousLine)) {
        start = previousLineStart;
        continue;
      }

      break;
    }

    return start;
  }

  function looksLikeFunctionHeader(header, language) {
    const text = normalizeCodeForFormatting(header).replace(/\s+/g, " ").trim().replace(/\{$/, "").trim();
    const lowered = text.toLowerCase();

    if (!text || /\b(if|for|while|switch|catch)\s*\(/.test(lowered) || /\belse\b/.test(lowered) || /^do\b/.test(lowered)) {
      return false;
    }

    if (language === "javascript" || language === "typescript") {
      return /\bfunction\b\s*[A-Za-z_$]*\s*\([^)]*\)$/.test(text) ||
        /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*$/.test(text) ||
        /(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^;{}]*\)\s*$/.test(text);
    }

    if (language === "go") {
      return /^func\b[\s\S]*\([^)]*\)\s*$/.test(text);
    }

    return /[A-Za-z_~][\w:<>~*&\s]+\s+[A-Za-z_~][\w:<>~]*\s*\([^;{}]*\)\s*(?:const)?$/.test(text);
  }

  function getIndentWidth(line) {
    return String(line || "")
      .replace(/\t/g, "    ")
      .match(/^ */)[0].length;
  }

  function getAiModeButton(mode) {
    if (mode === "next") {
      return nextButton;
    }

    if (mode === "check") {
      return checkButton;
    }

    if (mode === "explain-selection") {
      return explainSelectionButton;
    }

    return nextButton;
  }

  function getAiModeLoadingText(mode) {
    if (mode === "next") {
      return "AI 正在判断下一段该写什么...";
    }

    if (mode === "check") {
      return "AI 正在检查已有代码...";
    }

    if (mode === "explain-selection") {
      return "AI 正在解释选中代码...";
    }

    return "AI 正在分析当前代码...";
  }

  function setAiRequestRunning(running) {
    nextButton.disabled = running;
    checkButton.disabled = running;
    if (running) {
      explainSelectionButton.disabled = true;
      insertSuggestionButton.disabled = true;
    }
    stopAiButton.hidden = !running;
    stopAiButton.disabled = !running;

    if (!running) {
      updateActionButtonStates();
    }
  }

  function createAiRequestState(mode) {
    aiRequestSequence += 1;
    return {
      id: "ai-" + Date.now() + "-" + aiRequestSequence,
      mode,
      canceled: false
    };
  }

  function cancelActiveAiRequest() {
    const request = activeAiRequest;

    if (!request || request.canceled) {
      return;
    }

    request.canceled = true;
    stopAiButton.disabled = true;
    output.textContent = "正在停止生成...";

    sendRuntimeMessage({
      type: "CANCEL_CODING_AI",
      requestId: request.id
    }).catch(() => {
      // The original AI request will still resolve or reject and restore the UI.
    });
  }

  async function runAI(mode) {
    clearSuggestionPreview();
    if (activeAiRequest) {
      output.textContent = "已有 AI 请求正在运行，可以先点击“停止生成”。";
      return;
    }

    await syncCurrentProblemPageLanguage({ silent: true });

    const problem = sanitizeText(problemInput.value) || lastProblemContext || buildLocalProblemContextV3();
    const code = codeInput.value;
    const cursorOffset = typeof codeInput.selectionStart === "number" ? codeInput.selectionStart : code.length;
    const cursorPosition = getCodeCursorPosition(cursorOffset);
    const selectionStart = Math.min(getSelectionStart(codeInput), getSelectionEnd(codeInput));
    const selectionEnd = Math.max(getSelectionStart(codeInput), getSelectionEnd(codeInput));
    const selectedCode = code.slice(selectionStart, selectionEnd);
    const selectionStartPosition = getCodeCursorPosition(selectionStart);
    const selectionEndPosition = getCodeCursorPosition(selectionEnd);
    const codeBeforeCursor = code.slice(0, cursorOffset);
    const codeAfterCursor = code.slice(cursorOffset);
    const button = getAiModeButton(mode);
    const isExplainSelection = mode === "explain-selection";
    const scopeDetails = mode === "next"
      ? buildSuggestionScopeDetails(code, cursorOffset)
      : null;
    const scopedCodeBeforeCursor = scopeDetails && scopeDetails.context
      ? "[建议范围上下文]\n" + scopeDetails.context + "\n\n[光标前代码]\n" + codeBeforeCursor
      : codeBeforeCursor;

    if (isExplainSelection && !selectedCode.trim()) {
      output.textContent = "请先在代码框中选中要解释的代码。";
      codeInput.focus();
      return;
    }

    if (!problem && !isExplainSelection) {
      output.textContent = "没有读取到题目上下文，请先点击“同步题目”。";
      return;
    }

    const request = createAiRequestState(mode);
    activeAiRequest = request;
    setAiRequestRunning(true);
    output.textContent = getAiModeLoadingText(mode);

    try {
      const messages = window.CodingAssistantCore.buildMessages({
        mode,
        problem,
        code,
        selectedCode,
        fullCodeWithLineNumbers: buildLineNumberedCode(code),
        codeBeforeCursor: scopedCodeBeforeCursor,
        codeAfterCursor,
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

      renderOutputText(response.answer, { linkLineReferences: true });
      enterReadingMode();

      if (mode === "next") {
        lastSuggestion = window.CodingAssistantCore.extractSuggestedCode(response.answer);
      } else {
        lastSuggestion = "";
      }
      updateActionButtonStates();

      saveDraft();
    } catch (error) {
      output.textContent = request.canceled ? "已停止生成。" : (error.message || String(error));
      enterReadingMode();
    } finally {
      if (activeAiRequest === request) {
        activeAiRequest = null;
        setAiRequestRunning(false);
      } else if (button) {
        button.disabled = false;
      }
    }
  }

  function enterReadingMode() {
    panel.classList.add("reading-mode");
    requestAnimationFrame(() => {
      output.scrollTop = 0;
    });
  }

  function leaveReadingMode() {
    panel.classList.remove("reading-mode");
  }

  function setProblemExpanded(expanded) {
    panel.classList.toggle("problem-expanded", expanded);
    problemToggleButton.textContent = expanded ? "收起题面" : "放大题面";

    if (expanded) {
      problemInput.focus();
    }
  }

  function toggleProblemExpanded() {
    setProblemExpanded(!panel.classList.contains("problem-expanded"));
  }

  function insertSuggestionAtCursor() {
    if (pendingSuggestionPreview) {
      confirmSuggestionPreview();
      return;
    }

    const suggestion = lastSuggestion || window.CodingAssistantCore.extractSuggestedCode(output.textContent);

    if (!suggestion) {
      output.textContent = "当前没有可插入的建议代码。请先点击“下一段该写什么”。";
      return;
    }

    const start = typeof codeInput.selectionStart === "number" ? codeInput.selectionStart : codeInput.value.length;
    const end = typeof codeInput.selectionEnd === "number" ? codeInput.selectionEnd : codeInput.value.length;
    const insertion = buildSuggestionInsertion(suggestion, start, end);
    const snapshot = createAssistantCodeSnapshot("插入建议");

    previewSuggestionInsertion(suggestion, insertion, snapshot);
  }

  function previewSuggestionInsertion(suggestion, insertion, snapshot) {
    leaveReadingMode();

    pendingSuggestionPreview = {
      code: codeInput.value,
      suggestion,
      insertion,
      snapshot
    };

    insertSuggestionButton.disabled = false;
    insertSuggestionButton.textContent = "确认插入";
    insertSuggestionButton.title = "已高亮插入位置，再点一次确认插入";
    codeEditor.classList.add("suggestion-preview");
    focusCodeEditorAtInsertion(insertion);
  }

  function confirmSuggestionPreview() {
    const preview = pendingSuggestionPreview;

    if (!preview) {
      return;
    }

    if (codeInput.value !== preview.code) {
      clearSuggestionPreview();
      insertSuggestionAtCursor();
      return;
    }

    const insertion = preview.insertion;
    const snapshot = preview.snapshot;

    recordDraftHistory(Date.now(), "插入前");
    clearSuggestionPreview();
    codeInput.setRangeText(insertion.text, insertion.start, insertion.end, "end");
    codeInput.dispatchEvent(new Event("input", { bubbles: true }));
    codeInput.focus();
    pushAiInsertSnapshot(snapshot);
  }

  function clearSuggestionPreview() {
    pendingSuggestionPreview = null;

    if (codeEditor) {
      codeEditor.classList.remove("suggestion-preview");
    }

    if (insertSuggestionButton) {
      insertSuggestionButton.textContent = insertSuggestionButtonDefaultText;
      insertSuggestionButton.title = "";
    }

    updateActionButtonStates();
  }

  function focusCodeEditorAtInsertion(insertion) {
    const start = Math.max(0, Math.min(insertion.start, codeInput.value.length));
    const end = Math.max(start, Math.min(insertion.end, codeInput.value.length));

    try {
      codeInput.focus({ preventScroll: true });
    } catch {
      codeInput.focus();
    }

    codeInput.setSelectionRange(start, end);
    scrollCodeOffsetIntoView(start);
    syncCodeEditorMetrics();
    flashLocatedCodeLine();
  }

  function scrollCodeOffsetIntoView(offset) {
    const position = getCodeCursorPosition(offset);
    const metrics = getCodeInputMetrics();
    const visibleHeight = Math.max(metrics.lineHeight, codeInput.clientHeight - metrics.paddingTop - metrics.paddingBottom);
    const targetTop = metrics.paddingTop + (position.line - 1) * metrics.lineHeight;
    const targetBottom = targetTop + metrics.lineHeight;
    const currentTop = codeInput.scrollTop;
    const currentBottom = currentTop + visibleHeight;

    if (targetTop < currentTop) {
      codeInput.scrollTop = Math.max(0, targetTop - metrics.lineHeight);
      return;
    }

    if (targetBottom > currentBottom) {
      codeInput.scrollTop = Math.max(0, targetBottom - visibleHeight + metrics.lineHeight);
    }
  }

  function formatCodeInEditor() {
    clearSuggestionPreview();
    const rawCode = normalizeCodeForFormatting(codeInput.value);

    if (!rawCode.trim()) {
      flashFormatButton("无代码");
      return;
    }

    const language = getFormattingLanguage(rawCode);
    const formattedCode = formatCodeText(rawCode, language);
    const nextCode = formattedCode || rawCode;
    recordDraftHistory(Date.now(), "格式化前");
    const selectionStart = typeof codeInput.selectionStart === "number" ? codeInput.selectionStart : nextCode.length;
    const selectionEnd = typeof codeInput.selectionEnd === "number" ? codeInput.selectionEnd : nextCode.length;
    const scrollTop = codeInput.scrollTop;

    codeInput.value = nextCode;
    codeInput.setSelectionRange(
      Math.min(selectionStart, nextCode.length),
      Math.min(selectionEnd, nextCode.length)
    );
    codeInput.scrollTop = scrollTop;
    codeInput.dispatchEvent(new Event("input", { bubbles: true }));
    codeInput.focus();
    flashFormatButton(nextCode === rawCode ? "已整理" : "已格式化");
  }

  function flashFormatButton(text) {
    if (!formatCodeButton) {
      return;
    }

    if (formatCodeButtonResetTimer) {
      clearTimeout(formatCodeButtonResetTimer);
    }

    formatCodeButton.textContent = text;
    formatCodeButtonResetTimer = window.setTimeout(() => {
      formatCodeButton.textContent = "格式化";
      formatCodeButtonResetTimer = 0;
    }, 1200);
  }

  function handleCodeEditorKeydown(event) {
    clearSuggestionPreview();

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === "Tab") {
      handleTabKey(event);
      return;
    }

    if (event.key === "Enter") {
      handleEnterKey(event);
      return;
    }

    if (event.key === "Backspace") {
      handlePairBackspace(event);
      return;
    }

    if (PAIR_MAP[event.key]) {
      handleOpeningPairKey(event);
      return;
    }

    if (isClosingPairKey(event.key)) {
      handleClosingPairKey(event);
    }
  }

  const PAIR_MAP = {
    "(": ")",
    "[": "]",
    "{": "}",
    "\"": "\"",
    "'": "'",
    "`": "`"
  };

  const CLOSING_PAIR_KEYS = new Set(Object.values(PAIR_MAP));

  function isClosingPairKey(key) {
    return CLOSING_PAIR_KEYS.has(key);
  }

  function getIndentUnit() {
    return getIndentUnitForLanguage(languageSelect.value);
  }

  function getIndentUnitForLanguage(language) {
    return ["javascript", "typescript", "html", "css"].includes(String(language || "").toLowerCase()) ? "  " : "    ";
  }

  function getFormattingLanguage(code) {
    if (languageSelect.value && languageSelect.value !== "auto") {
      return languageSelect.value;
    }

    const detected = window.CodingAssistantCore && typeof window.CodingAssistantCore.detectLanguage === "function"
      ? window.CodingAssistantCore.detectLanguage(code, "auto")
      : "javascript";

    if (detected === "javascript" && /\b(vector|unordered_map|unordered_set|ListNode|TreeNode|public:|private:|protected:|nullptr)\b/.test(code)) {
      return "cpp17";
    }

    return detected;
  }

  function formatCodeText(code, language) {
    const unit = getIndentUnitForLanguage(language);

    if (language === "python") {
      return formatPythonCode(code, unit);
    }

    if (isBraceFormattingLanguage(language)) {
      return formatBraceLanguageCode(code, unit);
    }

    return cleanupLooseCode(code, unit);
  }

  function isBraceFormattingLanguage(language) {
    return new Set([
      "c",
      "cpp98",
      "cpp11",
      "cpp14",
      "cpp17",
      "cpp20",
      "csharp",
      "css",
      "go",
      "java8",
      "java11",
      "java17",
      "javascript",
      "typescript"
    ]).has(String(language || "").toLowerCase());
  }

  function formatBraceLanguageCode(code, unit) {
    const lines = normalizeCodeForFormatting(code).split("\n");
    const result = [];
    const state = { inBlockComment: false };
    let indentLevel = 0;
    let previousWasBlank = false;

    for (const rawLine of lines) {
      const trimmedRight = rawLine.replace(/\t/g, unit).replace(/[ \t]+$/g, "");
      const trimmed = trimmedRight.trim();

      if (!trimmed) {
        if (!previousWasBlank && result.length > 0) {
          result.push("");
          previousWasBlank = true;
        }
        continue;
      }

      const structureLine = stripStructuralNoise(trimmedRight, state);
      let currentIndent = indentLevel;

      if (startsWithClosingBrace(trimmed)) {
        currentIndent -= 1;
      }

      if (isAccessModifierLine(trimmed) || isCaseLabelLine(trimmed)) {
        currentIndent -= 1;
      }

      if (isPreprocessorDirectiveLine(trimmed)) {
        currentIndent = 0;
      }

      currentIndent = Math.max(0, currentIndent);
      result.push(unit.repeat(currentIndent) + trimmed);
      previousWasBlank = false;

      const braceDelta = countOccurrences(structureLine, "{") - countOccurrences(structureLine, "}");
      indentLevel = Math.max(0, indentLevel + braceDelta);

      if (isAccessModifierLine(trimmed) || isCaseLabelLine(trimmed)) {
        indentLevel = Math.max(indentLevel, currentIndent + 1);
      }
    }

    return finalizeFormattedCode(result.join("\n"));
  }

  function formatPythonCode(code, unit) {
    const lines = normalizeCodeForFormatting(code).split("\n");
    const result = [];
    let indentLevel = 0;
    let previousWasBlank = false;

    for (const rawLine of lines) {
      const trimmedRight = rawLine.replace(/\t/g, unit).replace(/[ \t]+$/g, "");
      const trimmed = trimmedRight.trim();

      if (!trimmed) {
        if (!previousWasBlank && result.length > 0) {
          result.push("");
          previousWasBlank = true;
        }
        continue;
      }

      let currentIndent = indentLevel;

      if (/^(elif\b|else\s*:|except\b|finally\s*:)/.test(trimmed)) {
        currentIndent = Math.max(0, currentIndent - 1);
      }

      result.push(unit.repeat(currentIndent) + trimmed);
      previousWasBlank = false;
      indentLevel = currentIndent;

      if (/:\s*(#.*)?$/.test(trimmed)) {
        indentLevel += 1;
      }
    }

    return finalizeFormattedCode(result.join("\n"));
  }

  function cleanupLooseCode(code, unit) {
    const lines = normalizeCodeForFormatting(code)
      .split("\n")
      .map((line) => line.replace(/\t/g, unit).replace(/[ \t]+$/g, ""));

    return finalizeFormattedCode(lines.join("\n"));
  }

  function finalizeFormattedCode(text) {
    return stripCodeEdgeBlankLines(String(text || ""))
      .replace(/\n{3,}/g, "\n\n");
  }

  function stripCodeEdgeBlankLines(text) {
    return String(text || "")
      .replace(/^(?:[ \t]*\n)+/, "")
      .replace(/(?:\n[ \t]*)+$/, "");
  }

  function normalizeCodeForFormatting(value) {
    return String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function stripStructuralNoise(line, state) {
    let result = "";
    let quote = "";
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (state.inBlockComment) {
        if (char === "*" && next === "/") {
          state.inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === quote) {
          quote = "";
        }

        continue;
      }

      if (char === "/" && next === "*") {
        state.inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "/" && next === "/") {
        break;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      result += char;
    }

    return result;
  }

  function countOccurrences(value, needle) {
    return Array.from(String(value || "")).reduce((count, char) => count + (char === needle ? 1 : 0), 0);
  }

  function startsWithClosingBrace(line) {
    return /^}/.test(line);
  }

  function isAccessModifierLine(line) {
    return /^(public|private|protected)\s*:\s*$/.test(line);
  }

  function isCaseLabelLine(line) {
    return /^(case\b[\s\S]*:|default\s*:)\s*$/.test(line);
  }

  function isPreprocessorDirectiveLine(line) {
    return /^#\s*[A-Za-z_]/.test(line);
  }

  function buildSuggestionInsertion(suggestion, start, end) {
    const normalizedSuggestion = normalizeSuggestionForInsert(suggestion);
    const value = codeInput.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextLineBreak = value.indexOf("\n", end);
    const lineEnd = nextLineBreak < 0 ? value.length : nextLineBreak;
    const beforeCursor = value.slice(lineStart, start);
    const afterCursor = value.slice(end, lineEnd);
    const currentLine = value.slice(lineStart, lineEnd);

    if (beforeCursor.trim() === "" && afterCursor.trim() === "") {
      const currentIndent = (currentLine.match(/^[ \t]*/) || [""])[0];

      return {
        start: lineStart,
        end: lineEnd,
        text: indentSnippet(normalizedSuggestion, currentIndent)
      };
    }

    const prefix = start > 0 && !/\n$/.test(value.slice(0, start)) ? "\n" : "";
    const suffix = end < value.length && !/^\n/.test(value.slice(end)) ? "\n" : "";

    return {
      start,
      end,
      text: prefix + normalizedSuggestion + suffix
    };
  }

  function normalizeSuggestionForInsert(suggestion) {
    const normalizedLines = stripSurroundingBlankLines(String(suggestion || "").replace(/\r\n?/g, "\n"));

    if (!normalizedLines) {
      return "";
    }

    return dedentCodeBlock(normalizedLines);
  }

  function stripSurroundingBlankLines(text) {
    return String(text || "")
      .replace(/^(?:[ \t]*\n)+/, "")
      .replace(/(?:\n[ \t]*)+$/, "");
  }

  function dedentCodeBlock(text) {
    const lines = String(text || "").split("\n");
    let minIndent = Infinity;

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const indent = (line.match(/^[ \t]*/) || [""])[0].length;
      minIndent = Math.min(minIndent, indent);
    }

    if (!Number.isFinite(minIndent) || minIndent <= 0) {
      return lines.join("\n");
    }

    return lines
      .map((line) => {
        if (!line.trim()) {
          return "";
        }

        let removable = minIndent;
        let index = 0;

        while (index < line.length && removable > 0 && (line[index] === " " || line[index] === "\t")) {
          index += 1;
          removable -= 1;
        }

        return line.slice(index);
      })
      .join("\n");
  }

  function indentSnippet(text, indent) {
    return String(text || "")
      .split("\n")
      .map((line) => (line ? indent + line : ""))
      .join("\n");
  }

  function replaceCodeRange(start, end, text, selectionStart, selectionEnd = selectionStart) {
    codeInput.setRangeText(text, start, end, "end");
    codeInput.setSelectionRange(selectionStart, selectionEnd);
    codeInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleOpeningPairKey(event) {
    const value = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    const opener = event.key;
    const closer = PAIR_MAP[opener];

    if (start === end && isQuoteKey(opener) && value[start] === closer) {
      event.preventDefault();
      codeInput.setSelectionRange(start + 1, start + 1);
      return;
    }

    if (start === end && isQuoteKey(opener) && shouldNotAutoPairQuote(value, start)) {
      return;
    }

    event.preventDefault();

    if (start !== end) {
      replaceCodeRange(start, end, opener + value.slice(start, end) + closer, start + 1, end + 1);
      return;
    }

    replaceCodeRange(start, end, opener + closer, start + 1);
  }

  function handleClosingPairKey(event) {
    const value = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;

    if (start !== end) {
      return;
    }

    if (value[start] === event.key) {
      event.preventDefault();
      codeInput.setSelectionRange(start + 1, start + 1);
      return;
    }

    if (event.key === "}") {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const beforeCursor = value.slice(lineStart, start);
      const removable = getTrailingIndentRemoval(beforeCursor, getIndentUnit());

      if (removable > 0 && beforeCursor.trim() === "") {
        event.preventDefault();
        replaceCodeRange(start - removable, start, event.key, start - removable + 1);
      }
    }
  }

  function handlePairBackspace(event) {
    const value = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;

    if (start !== end || start === 0) {
      return;
    }

    const previous = value[start - 1];
    const next = value[start];

    if (PAIR_MAP[previous] === next) {
      event.preventDefault();
      replaceCodeRange(start - 1, start + 1, "", start - 1);
    }
  }

  function handleTabKey(event) {
    event.preventDefault();

    if (codeInput.selectionStart !== codeInput.selectionEnd) {
      indentSelectedLines(event.shiftKey);
      return;
    }

    if (event.shiftKey) {
      unindentCurrentLine();
      return;
    }

    const start = codeInput.selectionStart;
    const unit = getIndentUnit();
    replaceCodeRange(start, start, unit, start + unit.length);
  }

  function handleEnterKey(event) {
    event.preventDefault();

    const value = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineBeforeCursor = value.slice(lineStart, start);
    const indent = (lineBeforeCursor.match(/^[ \t]*/) || [""])[0];
    const trimmedBefore = lineBeforeCursor.trimEnd();
    const previous = value[start - 1];
    const next = value[start];
    const unit = getIndentUnit();

    if (PAIR_MAP[previous] === next && ["{", "[", "("].includes(previous)) {
      const insertText = "\n" + indent + unit + "\n" + indent;
      replaceCodeRange(start, end, insertText, start + 1 + indent.length + unit.length);
      return;
    }

    const shouldIndent =
      /[\{\[\(]\s*$/.test(trimmedBefore) ||
      (languageSelect.value === "python" && /:\s*(#.*)?$/.test(trimmedBefore));
    const insertText = "\n" + indent + (shouldIndent ? unit : "");
    replaceCodeRange(start, end, insertText, start + insertText.length);
  }

  function indentSelectedLines(isOutdent) {
    const value = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = findSelectionLineEnd(value, end);
    const block = value.slice(lineStart, lineEnd);
    const unit = getIndentUnit();
    const lines = block.split("\n");
    let removedBeforeStart = 0;
    let totalRemoved = 0;
    let cursor = lineStart;

    const nextLines = lines.map((line) => {
      if (!isOutdent) {
        return unit + line;
      }

      const removed = getLeadingIndentRemoval(line, unit);

      if (cursor < start) {
        removedBeforeStart += Math.min(removed, Math.max(0, start - cursor));
      }

      totalRemoved += removed;
      cursor += line.length + 1;
      return line.slice(removed);
    });

    const nextBlock = nextLines.join("\n");
    codeInput.setRangeText(nextBlock, lineStart, lineEnd, "end");

    if (isOutdent) {
      const nextStart = Math.max(lineStart, start - removedBeforeStart);
      const nextEnd = Math.max(nextStart, end - totalRemoved);
      codeInput.setSelectionRange(nextStart, nextEnd);
    } else {
      codeInput.setSelectionRange(start + unit.length, end + unit.length * lines.length);
    }

    codeInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function unindentCurrentLine() {
    const value = codeInput.value;
    const start = codeInput.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const beforeCursor = value.slice(lineStart, start);
    const removable = getTrailingIndentRemoval(beforeCursor, getIndentUnit());

    if (removable > 0) {
      replaceCodeRange(start - removable, start, "", start - removable);
    }
  }

  function findSelectionLineEnd(value, end) {
    const normalizedEnd = end > 0 && value[end - 1] === "\n" ? end - 1 : end;
    const nextLineBreak = value.indexOf("\n", normalizedEnd);
    return nextLineBreak < 0 ? value.length : nextLineBreak;
  }

  function getLeadingIndentRemoval(line, unit) {
    if (line.startsWith(unit)) {
      return unit.length;
    }

    if (line.startsWith("\t")) {
      return 1;
    }

    const spaces = line.match(/^ +/);
    return spaces ? Math.min(unit.length, spaces[0].length) : 0;
  }

  function getTrailingIndentRemoval(text, unit) {
    if (text.endsWith(unit)) {
      return unit.length;
    }

    if (text.endsWith("\t")) {
      return 1;
    }

    const spaces = text.match(/ +$/);
    return spaces ? Math.min(unit.length, spaces[0].length) : 0;
  }

  function isQuoteKey(key) {
    return key === "\"" || key === "'" || key === "`";
  }

  function shouldNotAutoPairQuote(value, start) {
    const previous = value[start - 1] || "";
    const next = value[start] || "";

    if (previous === "\\") {
      return true;
    }

    return /[\w$]/.test(previous) && /[\w$]/.test(next);
  }

  async function insertCodeIntoPage() {
    const target = lastEditable || document.activeElement;
    const text = codeInput.value;

    if (!text) {
      output.textContent = "No code to insert.";
      return;
    }

    if (isLeetCodeProblemPage()) {
      let snapshot = null;

      try {
        snapshot = await createLeetCodeInsertSnapshot("插入到页面");
      } catch (error) {
        output.textContent = "保存 LeetCode 插入前快照失败，已取消插入：" + (error.message || String(error));
        return;
      }

      const insertResult = await insertCodeIntoLeetCodeEditor(text);

      if (insertResult === "inserted") {
        pushAiInsertSnapshot(snapshot);
        output.textContent = "已插入到 LeetCode 编辑器，可点击“撤销插入”回退。";
        return;
      }

      if (insertResult === "copied") {
        return;
      }

      if (!output.textContent.startsWith("LeetCode insert failed:")) {
        output.textContent = "LeetCode insert failed: code editor was not found or did not accept input.";
      }
      return;
    }

    if (!isEditable(target) || shadow.contains(target)) {
      output.textContent = "没有可插入的位置。请先点一下网页里的代码输入框，再回到这里点击“插入到页面”。";
      return;
    }

    const snapshot = createPageInsertSnapshot(target, "插入到页面");

    if (!snapshot) {
      output.textContent = "保存插入前快照失败，已取消插入。";
      return;
    }

    if ("value" in target) {
      const start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
      const end = typeof target.selectionEnd === "number" ? target.selectionEnd : target.value.length;
      try {
        target.setRangeText(text, start, end, "end");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.focus();
        pushAiInsertSnapshot(snapshot);
        output.textContent = "已插入到页面，可点击“撤销插入”回退。";
      } catch (error) {
        output.textContent = "插入到页面失败：" + (error.message || String(error));
      }
      return;
    }

    target.focus();
    if (!document.execCommand("insertText", false, text)) {
      output.textContent = "插入到页面失败：目标编辑器没有接受输入。";
      return;
    }

    pushAiInsertSnapshot(snapshot);
    output.textContent = "已插入到页面，可点击“撤销插入”回退。";
  }

  async function insertExternalEditorCodeIntoPage(text) {
    const preparedText = String(text || "");
    const target = lastEditable || document.activeElement;

    if (!preparedText) {
      throw new Error("No code to insert.");
    }

    if (isLeetCodeProblemPage()) {
      let snapshot = null;

      try {
        snapshot = await createLeetCodeInsertSnapshot("独立窗口插入");
      } catch (error) {
        throw new Error("保存 LeetCode 插入前快照失败，已取消插入：" + (error.message || String(error)));
      }

      const insertResult = await insertCodeIntoLeetCodeEditor(preparedText);

      if (insertResult === "inserted") {
        pushAiInsertSnapshot(snapshot);
        output.textContent = "独立窗口代码已插入到 LeetCode 编辑器，可点击“撤销插入”回退。";
        return {
          inserted: true,
          method: "leetcode"
        };
      }

      if (insertResult === "copied") {
        return {
          inserted: false,
          method: "clipboard"
        };
      }

      throw new Error(output.textContent || "LeetCode editor did not accept input.");
    }

    if (!isEditable(target) || shadow.contains(target)) {
      throw new Error("没有可插入的位置。请先点击网页里的代码输入框，再从独立窗口插入。");
    }

    const snapshot = createPageInsertSnapshot(target, "独立窗口插入");

    if (!snapshot) {
      throw new Error("保存插入前快照失败，已取消插入。");
    }

    if ("value" in target) {
      const start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
      const end = typeof target.selectionEnd === "number" ? target.selectionEnd : target.value.length;
      target.setRangeText(preparedText, start, end, "end");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.focus();
      pushAiInsertSnapshot(snapshot);
      output.textContent = "独立窗口代码已插入到页面，可点击“撤销插入”回退。";

      return {
        inserted: true,
        method: "value"
      };
    }

    target.focus();
    if (!document.execCommand("insertText", false, preparedText)) {
      throw new Error("目标编辑器没有接受输入。");
    }

    pushAiInsertSnapshot(snapshot);
    output.textContent = "独立窗口代码已插入到页面，可点击“撤销插入”回退。";

    return {
      inserted: true,
      method: "execCommand"
    };
  }

  function isLeetCodeProblemPage() {
    return Boolean(getLeetCodeProblemSlugV2 && getLeetCodeProblemSlugV2());
  }

  async function insertCodeIntoLeetCodeEditor(text) {
    lastLeetCodeInsertError = "";
    const preparedText = prepareLeetCodeInsertText(text);

    const insertedByPage = await withAssistantOverlayHidden(() => insertCodeIntoLeetCodeMainWorld(preparedText));

    if (insertedByPage) {
      return "inserted";
    }

    if (await copyCodeToClipboard(preparedText)) {
      const pastedByDebugger = await withAssistantOverlayHidden(() => pasteCodeIntoLeetCodeEditorFromClipboard(preparedText));

      if (pastedByDebugger) {
        return "inserted";
      }

      output.textContent = "Direct LeetCode insert failed. Code was copied to clipboard; click the LeetCode editor and press Ctrl+V.";
      focusLeetCodeEditor();
      return "copied";
    }

    if (lastLeetCodeInsertError) {
      output.textContent = "LeetCode insert failed: " + lastLeetCodeInsertError;
    }

    return "failed";
  }

  async function withAssistantOverlayHidden(callback) {
    const previousPanelVisibility = panel.style.visibility;
    const previousLauncherVisibility = launcher.style.visibility;
    const previousHostPointerEvents = host.style.pointerEvents;

    panel.style.visibility = "hidden";
    launcher.style.visibility = "hidden";
    host.style.pointerEvents = "none";

    try {
      await waitForAnimationFrame();
      return await callback();
    } finally {
      panel.style.visibility = previousPanelVisibility;
      launcher.style.visibility = previousLauncherVisibility;
      host.style.pointerEvents = previousHostPointerEvents;
    }
  }

  function waitForAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function insertCodeIntoLeetCodeMainWorld(text) {
    try {
      const response = await sendRuntimeMessage({
        type: "INSERT_LEETCODE_CODE",
        text
      });

      return Boolean(response.inserted);
    } catch (error) {
      lastLeetCodeInsertError = error.message || String(error);
      return false;
    }
  }

  async function pasteCodeIntoLeetCodeEditorFromClipboard(text) {
    try {
      const response = await sendRuntimeMessage({
        type: "PASTE_LEETCODE_CODE",
        text
      });

      return Boolean(response.inserted);
    } catch (error) {
      lastLeetCodeInsertError = error.message || String(error);
      return false;
    }
  }

  function insertCodeIntoLeetCodeDomEditor(text) {
    const editor = findVisibleLeetCodeEditor();

    if (!editor) {
      return false;
    }

    const preparedText = prepareLeetCodeInsertText(text);
    const target = editor.querySelector("textarea.inputarea") ||
      editor.querySelector("textarea") ||
      editor.querySelector(".cm-content[contenteditable='true']") ||
      editor.querySelector("[contenteditable='true']") ||
      editor;

    if (!target || !preparedText) {
      return false;
    }

    target.focus();
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    if (!("value" in target)) {
      selectEditableContents(target);
    }

    if (dispatchPasteText(target, preparedText)) {
      return true;
    }

    if (isMonacoInputTarget(target) || isCodeMirrorInputTarget(target)) {
      return document.execCommand("insertText", false, preparedText);
    }

    if ("value" in target) {
      target.value = preparedText;
      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: preparedText,
        inputType: "insertText"
      }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return document.execCommand("insertText", false, preparedText);
  }

  function isMonacoInputTarget(target) {
    return Boolean(target && target.closest && target.closest(".monaco-editor"));
  }

  function isCodeMirrorInputTarget(target) {
    return Boolean(target && target.closest && target.closest(".cm-editor, .CodeMirror"));
  }

  function selectEditableContents(target) {
    const selection = window.getSelection && window.getSelection();

    if (!selection || !document.createRange) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function prepareLeetCodeInsertText(text) {
    return String(text || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function focusLeetCodeEditor() {
    const editor = findVisibleLeetCodeEditor();

    if (!editor) {
      return;
    }

    const target = editor.querySelector("textarea.inputarea") ||
      editor.querySelector("textarea") ||
      editor.querySelector(".cm-content[contenteditable='true']") ||
      editor.querySelector("[contenteditable='true']") ||
      editor;

    if (target && target.focus) {
      target.focus();
    }
  }

  async function copyCodeToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to execCommand copy.
    }

    const copyBox = document.createElement("textarea");
    copyBox.value = text;
    copyBox.setAttribute("readonly", "");
    copyBox.style.position = "fixed";
    copyBox.style.left = "-9999px";
    copyBox.style.top = "0";
    document.body.appendChild(copyBox);
    copyBox.select();

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      copyBox.remove();
    }
  }

  function findVisibleLeetCodeEditor() {
    const selectors = [
      ".monaco-editor",
      ".cm-editor",
      "[data-track-load*='code_editor'] .monaco-editor",
      "[data-track-load*='code_editor'] .cm-editor",
      "[class*='monaco']",
      ".CodeMirror",
      ".cm-content[contenteditable='true']",
      "[contenteditable='true']"
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector))
        .filter((node) => !shadow.contains(node) && isVisibleElement(node));

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

    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  }

  function dispatchPasteText(target, text) {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      });

      target.dispatchEvent(pasteEvent);
      return pasteEvent.defaultPrevented;
    } catch {
      return false;
    }
  }

  function getDraftKey() {
    return "draft:" + location.origin + location.pathname;
  }

  function createDraftPayload(savedAt = Date.now()) {
    return {
      version: DRAFT_VERSION,
      code: codeInput.value,
      problem: problemInput.value,
      language: languageSelect.value,
      suggestionScope: getSelectedSuggestionScope(),
      source: lastServerSource,
      leetcodeTemplateCode: lastLeetCodeTemplateCode,
      leetcodeTemplateUrl: lastLeetCodeTemplateUrl,
      leetcodeTemplateLanguage: lastLeetCodeTemplateLanguage,
      history: draftHistory,
      savedAt
    };
  }

  function saveDraft(options = {}) {
    const now = Date.now();
    const shouldRecordHistory = options.recordHistory || shouldRecordDraftHistory(now);

    if (shouldRecordHistory) {
      recordDraftHistory(now, options.label || "自动保存");
    }

    const payload = createDraftPayload(Date.now());

    return new Promise((resolve) => {
      safeStorageSet({
        [getDraftKey()]: payload
      }, () => resolve(payload));
    });
  }

  function shouldRecordDraftHistory(now) {
    return window.CodingAssistantDraftHistory.shouldRecord({
      code: codeInput.value || "",
      previous: draftHistory[0],
      lastCode: lastDraftHistoryCode,
      lastSavedAt: lastDraftHistorySavedAt,
      minInterval: DRAFT_HISTORY_MIN_INTERVAL,
      now
    });
  }

  function recordDraftHistory(now = Date.now(), label = "自动保存") {
    const code = codeInput.value || "";

    if (!code.trim()) {
      return;
    }

    const previous = draftHistory[0];
    if (previous && previous.code === code) {
      return;
    }

    const entry = {
      code,
      label,
      selectionStart: getSelectionStart(codeInput),
      selectionEnd: getSelectionEnd(codeInput),
      scrollTop: codeInput.scrollTop,
      lineCount: getCodeLineCount(code),
      charCount: code.length,
      savedAt: now
    };

    draftHistory = window.CodingAssistantDraftHistory.dedupeAndLimit([entry, ...draftHistory], DRAFT_HISTORY_LIMIT);
    lastDraftHistoryCode = code;
    lastDraftHistorySavedAt = now;
    updateDraftHistorySelect();
  }

  function getCodeLineCount(code) {
    return window.CodingAssistantDraftHistory.getCodeLineCount(code);
  }

  function normalizeDraftHistory(history) {
    return window.CodingAssistantDraftHistory.normalize(history, DRAFT_HISTORY_LIMIT);
  }

  function updateDraftHistorySelect() {
    if (!draftHistorySelect) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = draftHistory.length ? "最近草稿" : "暂无草稿";
    fragment.appendChild(placeholder);

    draftHistory.forEach((entry, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = formatDraftHistoryLabel(entry);
      fragment.appendChild(option);
    });

    draftHistorySelect.replaceChildren(fragment);
    draftHistorySelect.value = "";
    draftHistorySelect.disabled = draftHistory.length === 0;
    draftHistorySelect.title = draftHistory.length ? "选择后恢复最近代码草稿" : "暂无可恢复的历史草稿";
  }

  function formatDraftHistoryLabel(entry) {
    return window.CodingAssistantDraftHistory.formatLabel(entry);
  }

  function restoreDraftHistoryEntry() {
    const index = Number(draftHistorySelect.value);
    const entry = draftHistory[index];
    draftHistorySelect.value = "";

    if (!entry) {
      return;
    }

    saveDraft({ recordHistory: true, label: "恢复前" });
    codeInput.value = entry.code;
    codeInput.setSelectionRange(
      Math.min(entry.selectionStart || 0, codeInput.value.length),
      Math.min(entry.selectionEnd || 0, codeInput.value.length)
    );
    codeInput.scrollTop = entry.scrollTop || 0;
    codeInput.dispatchEvent(new Event("input", { bubbles: true }));
    codeInput.focus();
    output.textContent = "已恢复 " + formatDraftHistoryLabel(entry) + " 的草稿。";
  }

  function applyDraft(draft) {
    if (!draft) {
      return false;
    }

    if (draft.version !== DRAFT_VERSION) {
      syncProblemContext();
      return false;
    }

    codeInput.value = draft.code || "";
    problemInput.value = draft.problem || "";
    languageSelect.value = draft.language || "auto";
    suggestionScopeSelect.value = draft.suggestionScope || "small";
    updateSuggestionScopeNote();
    syncCodeEditorMetrics();
    lastProblemContext = draft.problem || "";
    lastServerSource = draft.source || "页面";
    lastLeetCodeTemplateCode = draft.leetcodeTemplateCode || "";
    lastLeetCodeTemplateUrl = draft.leetcodeTemplateUrl || "";
    lastLeetCodeTemplateLanguage = draft.leetcodeTemplateLanguage || "";
    draftHistory = normalizeDraftHistory(draft.history);
    if (draft.code && !draftHistory.some((entry) => entry.code === draft.code)) {
      draftHistory.unshift({
        code: draft.code,
        label: "已恢复",
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
        lineCount: getCodeLineCount(draft.code),
        charCount: draft.code.length,
        savedAt: draft.savedAt || Date.now()
      });
      draftHistory = draftHistory.slice(0, DRAFT_HISTORY_LIMIT);
    }
    lastDraftHistoryCode = draftHistory[0] ? draftHistory[0].code : "";
    lastDraftHistorySavedAt = draftHistory[0] ? draftHistory[0].savedAt : 0;
    updateDraftHistorySelect();
    updateActionButtonStates();
    statusText.textContent = lastProblemContext
      ? "题目上下文：已恢复草稿 " + lastProblemContext.length + " 字"
      : "题目上下文：等待同步";
    sourceText.textContent = "来源：" + lastServerSource;

    return true;
  }

  function loadDraft(callback) {
    safeStorageGet(getDraftKey(), (items) => {
      const applied = applyDraft(items[getDraftKey()]);

      if (callback) {
        callback(applied);
      }
    });
  }

  function clampLauncherBottom(value) {
    const minBottom = 12;
    const maxBottom = Math.max(minBottom, window.innerHeight - 70);
    return Math.min(maxBottom, Math.max(minBottom, value));
  }

  function clampLauncherLeft(value) {
    const minLeft = 12;
    const launcherWidth = launcher.offsetWidth || 52;
    const maxLeft = Math.max(minLeft, window.innerWidth - launcherWidth - 12);
    return Math.min(maxLeft, Math.max(minLeft, value));
  }

  function getLauncherAnchorSide() {
    const launcherWidth = launcher.offsetWidth || 52;
    const launcherCenter = launcherLeft + launcherWidth / 2;
    return launcherCenter < window.innerWidth / 2 ? "left" : "right";
  }

  function syncLauncherAnchorFromPosition() {
    const launcherWidth = launcher.offsetWidth || 52;
    launcherAnchorSide = launcherSide;
    launcherAnchorOffset =
      launcherAnchorSide === "left"
        ? launcherLeft
        : window.innerWidth - launcherLeft - launcherWidth;
  }

  function getAnchoredLauncherLeft() {
    const launcherWidth = launcher.offsetWidth || 52;
    return launcherAnchorSide === "left"
      ? clampLauncherLeft(launcherAnchorOffset)
      : clampLauncherLeft(window.innerWidth - launcherWidth - launcherAnchorOffset);
  }

  function isLauncherNearLeftEdge() {
    return launcherLeft <= 18;
  }

  function isLauncherNearRightEdge() {
    const launcherWidth = launcher.offsetWidth || 52;
    return launcherLeft >= window.innerWidth - launcherWidth - 18;
  }

  function applyLauncherPosition(updateAnchor = true) {
    launcherLeft = clampLauncherLeft(launcherLeft);
    launcher.style.bottom = launcherBottom + "px";
    launcher.style.left = launcherLeft + "px";
    launcher.style.right = "auto";
    launcherSide = getLauncherAnchorSide();
    if (updateAnchor) {
      syncLauncherAnchorFromPosition();
    }
    updateLauncherDockState();
  }

  function updateLauncherDockState() {
    launcher.classList.remove("edge-hidden-left", "edge-hidden-right", "edge-active");
    const shouldHide = !panel.classList.contains("open") && !dragState;

    if (!shouldHide) {
      launcher.classList.add("edge-active");
      return;
    }

    if (isLauncherNearLeftEdge()) {
      launcher.classList.add("edge-hidden-left");
      return;
    }

    if (isLauncherNearRightEdge()) {
      launcher.classList.add("edge-hidden-right");
      return;
    }

    launcher.classList.add("edge-active");
  }

  function setPanelOpen(open) {
    if (open) {
      panel.classList.add("open");
    } else {
      panel.classList.remove("open");
    }

    updateLauncherDockState();
  }

  function togglePanelOpen() {
    setPanelOpen(!panel.classList.contains("open"));
  }

  function setAssistantHidden(hidden) {
    assistantHidden = Boolean(hidden);
    host.style.display = assistantHidden ? "none" : "";
  }

  function toggleAssistantVisibility() {
    setAssistantHidden(!assistantHidden);
  }

  function clampPanelSizeAndPosition() {
    const minMargin = 8;
    const maxWidth = Math.max(320, window.innerWidth - minMargin * 2);
    const maxHeight = Math.max(260, window.innerHeight - minMargin * 2);

    if (panel.offsetWidth > maxWidth) {
      panel.style.width = maxWidth + "px";
    }

    if (panel.offsetHeight > maxHeight) {
      panel.style.height = maxHeight + "px";
    }

    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const maxLeft = Math.max(minMargin, window.innerWidth - panelWidth - minMargin);
    const maxTop = Math.max(minMargin, window.innerHeight - panelHeight - minMargin);

    panelLeft = Math.min(maxLeft, Math.max(minMargin, panelLeft));
    panelTop = Math.min(maxTop, Math.max(minMargin, panelTop));
  }

  function applyPanelPosition() {
    panel.style.left = panelLeft + "px";
    panel.style.top = panelTop + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function snapPanelToLauncherSide() {
    const margin = 16;
    const panelWidth = panel.offsetWidth || 340;
    const panelHeight = panel.offsetHeight || 570;

    if (launcherSide === "left") {
      panelLeft = margin;
    } else {
      panelLeft = window.innerWidth - panelWidth - margin;
    }

    panelTop = window.innerHeight - panelHeight - margin;
    clampPanelSizeAndPosition();
    applyPanelPosition();
  }

  function beginLauncherDrag(event) {
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: launcherLeft,
      startBottom: launcherBottom,
      startSide: launcherSide,
      moved: false
    };
    launcher.setPointerCapture(event.pointerId);
    updateLauncherDockState();
  }

  function moveLauncherDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (Math.abs(deltaY) > 4 || Math.abs(deltaX) > 4) {
      dragState.moved = true;
    }

    launcherLeft = clampLauncherLeft(dragState.startLeft + deltaX);
    launcherBottom = clampLauncherBottom(dragState.startBottom - deltaY);
    applyLauncherPosition();
  }

  function endLauncherDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const moved = dragState.moved;
    const sideChanged = dragState.startSide !== launcherSide;
    launcher.releasePointerCapture(event.pointerId);
    dragState = null;

    if (!moved) {
      if (panel.classList.contains("open")) {
        setPanelOpen(false);
      } else {
        openPanel();
      }
      return;
    }

    if (panel.classList.contains("open") && sideChanged) {
      snapPanelToLauncherSide();
    }

    updateLauncherDockState();
  }

  function beginPanelDrag(event) {
    if (event.target && event.target.closest && event.target.closest("button, input, textarea, select, a")) {
      return;
    }

    panelDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelLeft,
      startTop: panelTop
    };
    header.setPointerCapture(event.pointerId);
  }

  function movePanelDrag(event) {
    if (!panelDragState || event.pointerId !== panelDragState.pointerId) {
      return;
    }

    const deltaX = event.clientX - panelDragState.startX;
    const deltaY = event.clientY - panelDragState.startY;
    panelLeft = panelDragState.startLeft + deltaX;
    panelTop = panelDragState.startTop + deltaY;
    clampPanelSizeAndPosition();
    applyPanelPosition();
  }

  function endPanelDrag(event) {
    if (!panelDragState || event.pointerId !== panelDragState.pointerId) {
      return;
    }

    header.releasePointerCapture(event.pointerId);
    panelDragState = null;
  }

  function beginPanelResizeTopLeft(event) {
    event.preventDefault();
    event.stopPropagation();

    panelResizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelLeft,
      startTop: panelTop,
      startWidth: panel.offsetWidth,
      startHeight: panel.offsetHeight
    };

    panelResizeTopLeft.setPointerCapture(event.pointerId);
  }

  function movePanelResizeTopLeft(event) {
    if (!panelResizeState || event.pointerId !== panelResizeState.pointerId) {
      return;
    }

    event.preventDefault();

    const minMargin = 8;
    const minWidth = Math.max(160, Math.min(320, window.innerWidth - minMargin * 2));
    const minHeight = Math.max(220, Math.min(420, window.innerHeight - minMargin * 2));
    const right = Math.min(
      window.innerWidth - minMargin,
      panelResizeState.startLeft + panelResizeState.startWidth
    );
    const bottom = Math.min(
      window.innerHeight - minMargin,
      panelResizeState.startTop + panelResizeState.startHeight
    );

    const nextLeft = Math.min(
      right - minWidth,
      Math.max(minMargin, panelResizeState.startLeft + event.clientX - panelResizeState.startX)
    );
    const nextTop = Math.min(
      bottom - minHeight,
      Math.max(minMargin, panelResizeState.startTop + event.clientY - panelResizeState.startY)
    );

    panelLeft = nextLeft;
    panelTop = nextTop;
    panel.style.width = Math.max(minWidth, right - nextLeft) + "px";
    panel.style.height = Math.max(minHeight, bottom - nextTop) + "px";
    applyPanelPosition();
  }

  function endPanelResizeTopLeft(event) {
    if (!panelResizeState || event.pointerId !== panelResizeState.pointerId) {
      return;
    }

    panelResizeTopLeft.releasePointerCapture(event.pointerId);
    panelResizeState = null;
    clampPanelSizeAndPosition();
    applyPanelPosition();
  }

  function openPanel() {
    const wasClosed = !panel.classList.contains("open");
    if (wasClosed) {
      snapPanelToLauncherSide();
    }
    setPanelOpen(true);
    syncCurrentProblemPageLanguage({ silent: true });

    if (wasClosed) {
      loadDraft(() => {
        if (!problemInput.value.trim()) {
          syncProblemContext();
        }
      });
      return;
    }

    if (!problemInput.value.trim()) {
      syncProblemContext();
    }
  }

  function isAssistantActionShortcutEnabled() {
    return !assistantHidden &&
      panel.classList.contains("open") &&
      Boolean(shadow.activeElement) &&
      shadow.activeElement !== launcher;
  }

  function triggerAiShortcut(mode, event) {
    event.preventDefault();
    event.stopPropagation();

    const button = getAiModeButton(mode);
    if (button && button.disabled) {
      return;
    }

    runAI(mode);
  }

  function triggerEditorActionShortcut(action, event) {
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  function handleGlobalShortcut(event) {
    if (event.defaultPrevented || event.repeat) {
      return;
    }

    const hasPrimaryModifier = event.ctrlKey || event.metaKey;
    const key = String(event.key || "").toLowerCase();

    if (hasPrimaryModifier && !event.altKey && key === "b") {
      event.preventDefault();
      event.stopPropagation();
      toggleAssistantVisibility();
      return;
    }

    if (!isAssistantActionShortcutEnabled()) {
      return;
    }

    if (event.altKey) {
      if (!hasPrimaryModifier && event.shiftKey && key === "f") {
        triggerEditorActionShortcut(formatCodeInEditor, event);
      }

      return;
    }

    if (!hasPrimaryModifier) {
      return;
    }

    if (key === "enter") {
      triggerAiShortcut(event.shiftKey ? "check" : "next", event);
      return;
    }

    if (!event.shiftKey && key === "e") {
      triggerAiShortcut("explain-selection", event);
    }
  }

  launcherLeft = Math.max(12, window.innerWidth - (launcher.offsetWidth || 52) - 16);
  applyLauncherPosition();
  clampPanelSizeAndPosition();
  applyPanelPosition();
  loadDraft();

  launcher.addEventListener("pointerdown", beginLauncherDrag);
  launcher.addEventListener("pointermove", moveLauncherDrag);
  launcher.addEventListener("pointerup", endLauncherDrag);
  launcher.addEventListener("pointercancel", endLauncherDrag);

  header.addEventListener("pointerdown", beginPanelDrag);
  header.addEventListener("pointermove", movePanelDrag);
  header.addEventListener("pointerup", endPanelDrag);
  header.addEventListener("pointercancel", endPanelDrag);

  panelResizeTopLeft.addEventListener("pointerdown", beginPanelResizeTopLeft);
  panelResizeTopLeft.addEventListener("pointermove", movePanelResizeTopLeft);
  panelResizeTopLeft.addEventListener("pointerup", endPanelResizeTopLeft);
  panelResizeTopLeft.addEventListener("pointercancel", endPanelResizeTopLeft);

  closeButton.addEventListener("click", () => {
    setPanelOpen(false);
  });

  window.addEventListener("resize", () => {
    launcherLeft = getAnchoredLauncherLeft();
    launcherBottom = clampLauncherBottom(launcherBottom);
    applyLauncherPosition(false);
    clampPanelSizeAndPosition();
    applyPanelPosition();
  });

  window.addEventListener("pointerup", () => {
    clampPanelSizeAndPosition();
    applyPanelPosition();
  });
  window.addEventListener("keydown", handleGlobalShortcut, true);

  problemToggleButton.addEventListener("click", toggleProblemExpanded);
  syncButton.addEventListener("click", syncProblemContext);
  nextButton.addEventListener("click", () => runAI("next"));
  checkButton.addEventListener("click", () => runAI("check"));
  stopAiButton.addEventListener("click", cancelActiveAiRequest);
  explainSelectionButton.addEventListener("click", () => runAI("explain-selection"));
  insertSuggestionButton.addEventListener("click", insertSuggestionAtCursor);
  insertPageButton.addEventListener("click", insertCodeIntoPage);
  externalEditorButton.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  externalEditorButton.addEventListener("click", openExternalEditor);
  undoInsertButton.addEventListener("click", undoLastAiInsert);
  formatCodeButton.addEventListener("click", formatCodeInEditor);
  draftHistorySelect.addEventListener("change", restoreDraftHistoryEntry);
  output.addEventListener("click", handleOutputClick);
  problemInput.addEventListener("input", saveDraft);
  suggestionScopeSelect.addEventListener("change", () => {
    updateSuggestionScopeNote();
    saveDraft();
  });
  codeInput.addEventListener("keydown", handleCodeEditorKeydown);
  codeInput.addEventListener("pointerdown", clearSuggestionPreview);
  codeInput.addEventListener("keyup", () => {
    syncCodeCursorState();
    updateActionButtonStates();
  });
  codeInput.addEventListener("click", () => {
    syncCodeCursorState();
    updateActionButtonStates();
  });
  codeInput.addEventListener("select", () => {
    syncCodeCursorState();
    updateActionButtonStates();
  });
  codeInput.addEventListener("scroll", syncCodeLineNumberScroll);
  codeInput.addEventListener("focus", () => {
    leaveReadingMode();
    syncCodeEditorMetrics();
  });
  codeInput.addEventListener("input", () => {
    clearSuggestionPreview();
    lastSuggestion = "";
    leaveReadingMode();
    syncCodeEditorMetrics();
    saveDraft();
    updateActionButtonStates();
  });
  languageSelect.addEventListener("change", saveDraft);

  safeAddStorageChangedListener((changes, areaName) => {
    if (areaName !== "local" || panel.classList.contains("open")) {
      return;
    }

    const change = changes[getDraftKey()];

    if (change && change.newValue) {
      applyDraft(change.newValue);
    }
  });

  safeAddRuntimeMessageListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "OPEN_CODING_ASSISTANT") {
      openPanel();
      return false;
    }

    if (message.type === "GET_CODING_ASSISTANT_PAGE_CONTEXT") {
      sendResponse({
        ok: true,
        draftKey: getDraftKey(),
        draft: createDraftPayload(Date.now()),
        payload: getPagePayloadV3(),
        localProblem: buildLocalProblemContextV3(),
        code: codeInput.value,
        language: languageSelect.value
      });
      return false;
    }

    if (message.type === "PREPARE_EXTERNAL_EDITOR") {
      saveDraft({ recordHistory: true, label: "打开独立窗口前" })
        .then((draft) => {
          setPanelOpen(false);
          sendResponse({
            ok: true,
            draftKey: getDraftKey(),
            draft
          });
        })
        .catch((error) => {
          sendResponse({ ok: false, error: error.message || String(error) });
        });
      return true;
    }

    if (message.type === "INSERT_CODE_FROM_EXTERNAL_EDITOR") {
      insertExternalEditorCodeIntoPage(message.text || "")
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
})();
