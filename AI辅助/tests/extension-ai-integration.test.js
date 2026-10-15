const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("manifest loads review dependencies before the content UI", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  scripts.forEach((file) => assert.ok(fs.existsSync(path.join(root, file)), file));
  assert.ok(scripts.indexOf("content/ai-budget.js") < scripts.indexOf("content/code-review.js"));
  assert.ok(scripts.indexOf("content/code-review.js") < scripts.indexOf("content/content-script.js"));
});

test("the actual service worker loads imports and relays budget retries and progress", async () => {
  let onMessage;
  const bodies = [];
  const progress = [];
  const context = vm.createContext({
    AbortController, URL, setTimeout, clearTimeout,
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(listener) { onMessage = listener; } } },
      contextMenus: { onClicked: { addListener() {} } },
      storage: {
        sync: { async get(defaults) { return { ...defaults, model: "test-model" }; } },
        local: { async get() { return { apiKey: "test-only-key" }; } }
      },
      tabs: { async sendMessage(tabId, message) { progress.push({ tabId, ...message }); } }
    },
    fetch: async (endpoint, init) => {
      bodies.push(JSON.parse(init.body));
      assert.equal(init.headers.Authorization, "Bearer test-only-key");
      return new Response(JSON.stringify({ choices: [{
        finish_reason: bodies.length === 1 ? "length" : "stop",
        message: { content: bodies.length === 1 ? "半截" : "完整检查结果" }
      }] }));
    }
  });
  context.importScripts = (...files) => files.forEach((file) => vm.runInContext(
    fs.readFileSync(path.resolve(root, "background", file), "utf8"), context, { filename: file }
  ));
  vm.runInContext(fs.readFileSync(path.join(root, "background/background.js"), "utf8"), context);
  const result = await new Promise((resolve) => {
    assert.equal(onMessage({ type: "CALL_CODING_AI", requestId: "review/1", taskType: "check",
      messages: [{ role: "user", content: "检查代码" }] }, { tab: { id: 42 } }, resolve), true);
  });
  assert.equal(result.ok, true);
  assert.equal(result.answer, "完整检查结果");
  assert.deepEqual(bodies.map((body) => body.max_completion_tokens), [4096, 8192]);
  assert.equal(progress[0].requestId, "review/1");
  assert.equal(progress[0].tabId, 42);
  assert.equal(progress[0].type, "AI_REQUEST_PROGRESS");
});

test("popup loads and saves budget and compatibility settings without syncing secrets", () => {
  const elements = new Map();
  let syncSaved;
  let localSaved;
  const context = vm.createContext({
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: "", checked: false, style: {}, addEventListener() {} });
      return elements.get(id);
    } },
    chrome: {
      runtime: {},
      storage: {
        sync: {
          get(defaults, callback) { callback(defaults); },
          set(settings, callback) { syncSaved = settings; callback(); }
        },
        local: {
          get(defaults, callback) { callback({ ...defaults, apiKey: "test-only-key" }); },
          set(settings, callback) { localSaved = settings; callback(); }
        }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, "frontend/popup/popup.js"), "utf8"), context);
  assert.equal(elements.get("max-output-tokens").value, "8192");
  assert.equal(elements.get("context-window-tokens").value, "32768");
  elements.get("max-output-tokens").value = "12000";
  elements.get("context-window-tokens").value = "128000";
  elements.get("token-parameter").value = "max_completion_tokens";
  elements.get("reasoning-mode").value = "low";
  let saved = false;
  context.saveSettings(() => { saved = true; });
  assert.equal(saved, true);
  assert.equal(syncSaved.maxOutputTokens, 12000);
  assert.equal(syncSaved.contextWindowTokens, 128000);
  assert.equal(syncSaved.tokenParameter, "max_completion_tokens");
  assert.equal(syncSaved.reasoningMode, "low");
  assert.equal(Object.hasOwn(syncSaved, "apiKey"), false);
  assert.equal(localSaved.apiKey, "test-only-key");
});
