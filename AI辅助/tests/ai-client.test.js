const assert = require("node:assert/strict");
const test = require("node:test");
const budget = require("../content/ai-budget.js");
const client = require("../background/ai-client.js");

let sequence = 0;
function result(content = "检查完成", finish = "stop") {
  return { choices: [{ finish_reason: finish, message: { content } }] };
}

function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function harness(replies, settings = {}) {
  const bodies = [];
  const progress = [];
  return {
    bodies, progress,
    run: (extra = {}) => client.call([{ role: "user", content: "检查结论：代码字符串包含建议代码" }], {
      settings: { apiEndpoint: "https://gateway.example/v1/chat/completions", model: "test-" + ++sequence, ...settings },
      taskType: "check", delay: async () => {}, onProgress: (text) => progress.push(text),
      fetch: async (url, init) => {
        bodies.push(JSON.parse(init.body));
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        assert.ok(reply, "must not issue an unexpected request");
        return reply;
      }, ...extra
    })
  };
}

test("explicit task budgets are not confused by code text and obey the configured cap", async () => {
  const state = harness([response(result())], { maxOutputTokens: 5000 });
  assert.equal(await state.run(), "检查完成");
  assert.equal(state.bodies[0].max_tokens, 4096);
  assert.equal(budget.outputTokens("check", [{ content: "x".repeat(24000) }], { maxOutputTokens: 5000 }), 5000);
  assert.equal(budget.outputTokens("test", [], {}), 256);
});

test("non-HTTP endpoint schemes fail configuration before any request", async () => {
  const state = harness([], { apiEndpoint: "file:///private/data" });
  await assert.rejects(state.run(), (error) => error.code === "CONFIG");
  assert.equal(state.bodies.length, 0);
});

test("a nonempty truncated answer is retried and cannot be accepted as complete", async () => {
  const state = harness([response(result("半截正文", "length")), response(result("完整正文"))]);
  assert.equal(await state.run(), "完整正文");
  assert.deepEqual(state.bodies.map((body) => body.max_tokens), [4096, 8192]);
  assert.ok(state.bodies.every((body) => !Object.hasOwn(body, "enable_thinking")));
});

test("a second truncated answer fails with partial text and bounded attempts", async () => {
  const state = harness([response(result("一半", "length")), response(result("仍未结束", "length"))]);
  await assert.rejects(state.run(), (error) => error.code === "OUTPUT_LIMIT" && error.partialAnswer === "仍未结束");
  assert.equal(state.bodies.length, 2);
});

test("reports the latest retry error instead of the first truncation error", async () => {
  const state = harness([response(result("", "length")), response({ error: { message: "model unavailable" } }, 404)]);
  await assert.rejects(state.run(), (error) => error.status === 404 && /model unavailable/.test(error.message));
});

test("reasoning-only retries do not inject provider-specific thinking switches", async () => {
  const state = harness([
    response({ choices: [{ finish_reason: "stop", message: { content: "", reasoning_content: "分析中" } }] }),
    response(result("最终答案"))
  ]);
  assert.equal(await state.run(), "最终答案");
  assert.ok(state.bodies.every((body) => !Object.hasOwn(body, "enable_thinking")));
});

test("only explicit unsupported parameters trigger a compatible fallback", async () => {
  const state = harness([
    response({ error: { message: "Unsupported parameter: max_tokens", param: "max_tokens" } }, 400),
    response(result())
  ]);
  await state.run();
  assert.equal(state.bodies[1].max_completion_tokens, 4096);
  assert.equal(Object.hasOwn(state.bodies[1], "max_tokens"), false);
  const fixed = harness([response({ error: { message: "Unsupported parameter: max_tokens", param: "max_tokens" } }, 400)], { tokenParameter: "max_tokens" });
  await assert.rejects(fixed.run(), (error) => error.status === 400);
  assert.equal(fixed.bodies.length, 1);
});

test("official endpoints use max_completion_tokens and omit temperature for reasoning models", async () => {
  const state = harness([response(result())], { apiEndpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-5", reasoningMode: "low" });
  await state.run();
  assert.equal(state.bodies[0].max_completion_tokens, 4096);
  assert.equal(state.bodies[0].reasoning_effort, "low");
  assert.equal(Object.hasOwn(state.bodies[0], "temperature"), false);
});

test("unsupported output values are reported instead of switching the parameter field", async () => {
  const state = harness([response({ error: {
    message: "Unsupported value: max_tokens cannot exceed 4096", param: "max_tokens", code: "unsupported_value"
  } }, 400)]);
  await assert.rejects(state.run(), (error) => error.code === "API_ERROR" && /cannot exceed 4096/.test(error.message));
  assert.equal(state.bodies.length, 1);
});

test("a long rate-limit wait is left for manual retry instead of issuing more requests", async () => {
  const state = harness([response({ error: { message: "Too many requests" } }, 429, { "retry-after": "60" })]);
  await assert.rejects(state.run(), (error) => error.code === "RATE_LIMIT" && error.retryAfterMs === 60000);
  assert.equal(state.bodies.length, 1);
});

test("transient errors are retried once while authentication failures are immediate", async () => {
  const state = harness([response({ error: { message: "busy" } }, 503), response(result())]);
  await state.run();
  assert.equal(state.bodies.length, 2);
  const auth = harness([response({ error: { message: "invalid key" } }, 401)]);
  await assert.rejects(auth.run(), (error) => error.code === "AUTH");
  assert.equal(auth.bodies.length, 1);
});

test("cancellation during retry prevents all subsequent requests", async () => {
  const controller = new AbortController();
  const state = harness([response(result("", "length"))]);
  await assert.rejects(state.run({ signal: controller.signal, onProgress: () => controller.abort() }), (error) => error.code === "CANCELED");
  assert.equal(state.bodies.length, 1);
});

test("cancellation remains attached while reading the response body", async () => {
  const controller = new AbortController();
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const pending = client.fetchResult("https://example.invalid", {}, {
    timeoutSeconds: 10, signal: controller.signal,
    fetch: async (url, init) => ({ ok: true, text: () => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")));
      began();
    }) })
  });
  await started;
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "CANCELED");
});

test("the request deadline also expires while waiting for the body", async () => {
  await assert.rejects(client.fetchResult("https://example.invalid", {}, {
    timeoutSeconds: 0.02,
    fetch: async (url, init) => ({ ok: true, text: () => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Deadline", "AbortError")));
    }) })
  }), (error) => error.code === "TIMEOUT");
});

test("context overflow fails before sending any request", async () => {
  let sent = false;
  await assert.rejects(client.call([{ content: "x".repeat(20000) }], {
    settings: { apiEndpoint: "https://example.invalid", model: "test", contextWindowTokens: 4096 },
    fetch: async () => { sent = true; }
  }), (error) => error.code === "CONTEXT_LIMIT");
  assert.equal(sent, false);
});
