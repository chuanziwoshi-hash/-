const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content", "content-script.js"), "utf8");
const answer = JSON.stringify({ summary: "检查完成，暂无明确问题。", issues: [], needsContext: [] });

function extract(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const tail = source.slice(start);
  const end = tail.match(/\r?\n  \}(?=\r?\n)/);
  assert.ok(end, name + " boundary");
  return tail.slice(0, end.index + end[0].length);
}

function setup(replies) {
  const element = () => ({ textContent: "", disabled: false, hidden: false, value: "", dataset: {}, scrollTop: 0 });
  const calls = [];
  const context = vm.createContext({
    codeInput: { ...element(), value: "int a = 1;" }, problemInput: { ...element(), value: "输入输出测试。" },
    languageSelect: { ...element(), value: "cpp17" }, output: element(),
    nextButton: element(), checkButton: element(), retryCheckButton: element(), stopAiButton: element(),
    explainSelectionButton: element(), insertSuggestionButton: element(),
    activeAiRequest: null, aiRequestSequence: 0, codeReviewSession: null, lastSuggestion: "", lastProblemContext: "",
    chrome: {
      storage: { sync: { get: (defaults, callback) => callback(defaults) } },
      runtime: { sendMessage: (message, callback) => {
        calls.push(message);
        if (message.type === "CANCEL_CODING_AI") { callback({ ok: true }); return; }
        const reply = replies.shift();
        if (typeof reply === "function") reply(message, callback);
        else callback(reply || { ok: true, answer });
      } }
    },
    clearSuggestionPreview() {}, updateActionButtonStates() {}, enterReadingMode() {},
    syncCurrentProblemPageLanguage: async () => {}, getRuntimeLastErrorMessage: () => "",
    isExtensionContextAvailable: () => true, buildLocalProblemContextV3: () => "",
    sanitizeText: (value) => value.trim(), renderOutputText: (text, options) => { context.output.textContent = text; context.linked = options.linkLineReferences; }
  });
  context.window = context;
  for (const file of ["assistant-core.js", "ai-budget.js", "code-review.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "content", file), "utf8"), context);
  }
  const names = ["isReviewOutdated", "updateReviewRetryButton", "renderCodeReview", "notifyReviewContextChange", "loadReviewSettings",
    "runCodeReview", "runAI", "createAiRequestState", "setAiRequestRunning", "cancelActiveAiRequest", "sendRuntimeMessage"];
  vm.runInContext(names.map(extract).join("\n"), context);
  return { context, calls };
}

test("check action routes to the new review without changing code", async () => {
  const { context, calls } = setup([]);
  await context.runAI("check");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskType, "check");
  assert.match(context.output.textContent, /检查已完成/);
  assert.equal(context.codeInput.value, "int a = 1;");
  assert.equal(context.retryCheckButton.hidden, true);
  assert.equal(context.nextButton.disabled, false);
});

test("retry is offered for failed work and preserves backend error codes", async () => {
  const { context, calls } = setup([{ ok: false, code: "AUTH", error: "invalid key", status: 401 }]);
  await context.runAI("check");
  assert.match(context.output.textContent, /invalid key/);
  assert.equal(context.retryCheckButton.hidden, false);
  await context.runCodeReview(true);
  assert.equal(calls.length, 2);
  assert.match(context.output.textContent, /检查已完成/);
});

test("edited snapshots disable retry and do not link old line numbers", async () => {
  const { context } = setup([{ ok: false, code: "AUTH", error: "invalid key" }]);
  await context.runAI("check");
  context.codeInput.value = "changed";
  context.notifyReviewContextChange();
  assert.equal(context.retryCheckButton.disabled, true);
  assert.match(context.output.textContent, /对应开始检查时的版本/);
  assert.equal(context.linked, false);
});

test("stop cancels the current child request and prevents any subsequent requests", async () => {
  let finish;
  const { context, calls } = setup([(message, callback) => { finish = callback; }]);
  const pending = context.runAI("check");
  await new Promise(setImmediate);
  const childId = context.activeAiRequest.childId;
  context.cancelActiveAiRequest();
  assert.equal(calls.at(-1).type, "CANCEL_CODING_AI");
  assert.equal(calls.at(-1).requestId, childId);
  finish({ ok: false, code: "CANCELED", error: "已停止" });
  await pending;
  assert.equal(calls.length, 2);
  assert.match(context.output.textContent, /已停止检查/);
  assert.equal(context.activeAiRequest, null);
});

test("stop during preparation does not leave a stopping message or send a model request", async () => {
  const { context, calls } = setup([]);
  let prepared;
  context.syncCurrentProblemPageLanguage = () => new Promise((resolve) => { prepared = resolve; });
  const pending = context.runAI("check");
  context.cancelActiveAiRequest();
  prepared();
  await pending;
  assert.equal(calls.filter((call) => call.type === "CALL_CODING_AI").length, 0);
  assert.equal(context.output.textContent, "已停止检查。");
  assert.equal(context.stopAiButton.hidden, true);
});
