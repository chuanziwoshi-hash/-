const assert = require("node:assert/strict");
const test = require("node:test");
const budget = require("../content/ai-budget.js");
const review = require("../content/code-review.js");

function answer(summary = "本段已核对，暂无明确问题。", issues = [], needsContext = []) {
  return JSON.stringify({ summary, issues, needsContext });
}
function create(code, extra = {}) {
  return review.createSession({ code, problem: "检查代码是否正确实现输入输出。", language: "cpp17", ...extra });
}
function options(request, extra = {}) {
  return { request, isCanceled: () => false, onProgress() {}, ...extra };
}
function codedError(code) { return Object.assign(new Error(code), { code }); }

test("partitioned long code covers every character and preserves original line numbers", () => {
  const code = Array.from({ length: 1500 }, (_, i) => "int value" + i + " = " + i + ";").join("\n") + "\nTAIL_MARKER";
  const session = create(code);
  assert.ok(session.parts.length > 1);
  assert.equal(session.parts.map((part) => session.code.slice(part.start, part.end)).join(""), code);
  for (const part of session.parts) {
    assert.equal(part.startLine, code.slice(0, part.start).split("\n").length);
    const messages = review.messagesForPart(session, part);
    assert.ok(budget.messageTokens(messages) + 4096 + 1024 <= session.settings.contextWindowTokens);
  }
  assert.match(review.messagesForPart(session, session.parts.at(-1))[1].content, /TAIL_MARKER/);
});

test("minified lines and unicode are split without losing text", () => {
  const code = "let text='" + "abc😀".repeat(10000) + "';";
  const session = create(code);
  assert.ok(session.parts.length > 1);
  assert.equal(session.parts.map((part) => code.slice(part.start, part.end)).join(""), code);
  assert.ok(session.parts.every((part) => part.startLine === 1));
  assert.ok(session.parts.every((part) => !/[\uD800-\uDBFF]$/.test(code.slice(part.start, part.end))));
});

test("short code is checked once and progress never reports success before completion", async () => {
  const session = create("int main() { return 0; }");
  let requests = 0;
  const states = [];
  await review.run(session, options(async () => { requests += 1; return answer(); }, { onProgress: (state) => states.push(review.format(state)) }));
  assert.equal(requests, 1);
  assert.equal(review.isComplete(session), true);
  assert.match(states[0], /检查进行中/);
  assert.match(states.at(-1), /检查已完成/);
});

test("failed segments can resume without rerunning completed segments", async () => {
  const session = create("int value = 1;\n".repeat(500));
  const failed = session.parts[1];
  let failedOnce = false;
  const seen = new Map();
  const request = async (messages, task) => {
    if (task === "check-global") return answer("整体已复核。");
    const matched = messages[1].content.match(/只报告属于第 (\d+)～(\d+) 行/);
    const start = Number(matched[1]);
    seen.set(start, (seen.get(start) || 0) + 1);
    if (start === failed.startLine && !failedOnce) { failedOnce = true; throw codedError("NETWORK"); }
    return answer();
  };
  await review.run(session, options(request));
  assert.equal(review.isComplete(session), false);
  assert.match(review.format(session), /尚未完成/);
  await review.run(session, options(request));
  assert.equal(review.isComplete(session), true);
  for (const part of session.parts) assert.equal(seen.get(part.startLine), part === failed ? 2 : 1);
});

test("truncation subdivides only the affected part with bounded depth", async () => {
  const session = create("int value = 1;\n".repeat(100));
  let calls = 0;
  await review.run(session, options(async () => { calls += 1; throw codedError("OUTPUT_LIMIT"); }));
  assert.equal(review.isComplete(session), false);
  assert.ok(session.parts.every((part) => part.depth <= 2));
  assert.ok(calls <= 13);
  assert.equal(session.parts.map((part) => session.code.slice(part.start, part.end)).join(""), session.code);
});

test("canceling retains completed findings and sends no later segment or global request", async () => {
  const session = create("int value = 1;\n".repeat(500));
  let canceled = false;
  let calls = 0;
  await review.run(session, options(async () => { calls += 1; return answer(); }, {
    isCanceled: () => canceled,
    onProgress: (state) => { if (state.parts[0].status === "done") canceled = true; }
  }));
  assert.equal(calls, 1);
  assert.equal(session.parts[0].status, "done");
  assert.equal(session.stopped, true);
  assert.equal(review.isComplete(session), false);
  assert.match(review.format(session), /已停止检查/);
});

test("authentication failure halts the job instead of trying every segment", async () => {
  const session = create("int value = 1;\n".repeat(500));
  let calls = 0;
  await review.run(session, options(async () => { calls += 1; throw codedError("AUTH"); }));
  assert.equal(calls, 1);
  assert.equal(session.phase, "incomplete");
});

test("global review runs after every local section and can request original related code", async () => {
  const session = create("int value = 1;\n".repeat(500));
  let calls = 0;
  let globalCalls = 0;
  let followupCalls = 0;
  await review.run(session, options(async (messages, task) => {
    calls += 1;
    if (task === "check-global") {
      globalCalls += 1;
      assert.ok(session.parts.every((part) => part.status === "done"));
      return answer("需核对函数之间的数据传递。", [], [{ startLine: 450, endLine: 455, reason: "验证尾部代码" }]);
    }
    if (messages[1].content.includes("关联复核目标")) {
      followupCalls += 1;
      assert.match(messages[1].content, /450 \| int value/);
    }
    return answer();
  }));
  assert.equal(globalCalls, 1);
  assert.equal(followupCalls, 1);
  assert.equal(calls, session.parts.length + 2);
  assert.equal(review.isComplete(session), true);
});

test("invalid results and invented line numbers are retried but not accepted", async () => {
  const session = create("int a = 1;");
  let calls = 0;
  await review.run(session, options(async () => {
    calls += 1;
    return answer("有问题", [{ line: 900, title: "越界", detail: "错误", suggestion: "修复" }]);
  }));
  assert.equal(calls, 2);
  assert.equal(session.parts[0].status, "failed");
  assert.equal(review.issuesFor(session).length, 0);
});

test("duplicate problems are merged and stale results are clearly labeled", async () => {
  const session = create("int a = 1;");
  const issue = { severity: "high", line: 1, title: "变量问题", detail: "证据", suggestion: "建议" };
  await review.run(session, options(async () => answer("有问题", [issue, { ...issue, title: "变量 问题。" }])));
  assert.equal(review.issuesFor(session).length, 1);
  assert.match(review.format(session, true), /对应开始检查时的版本/);
});

test("global summaries are batched instead of growing into an oversized request", async () => {
  const session = create("int value = 1;\n".repeat(3000));
  let globalCalls = 0;
  await review.run(session, options(async (messages, task) => {
    assert.ok(budget.messageTokens(messages) + 4096 + 1024 <= session.settings.contextWindowTokens);
    if (task === "check-global") globalCalls += 1;
    return answer("各段均已核对。".repeat(10));
  }));
  assert.ok(globalCalls > 1);
  assert.equal(review.isComplete(session), true);
});

test("global failure resumes only failed summary tasks", async () => {
  const session = create("int value = 1;\n".repeat(3000));
  let failure = true;
  const seen = new Map();
  const request = async (messages, task) => {
    const key = JSON.stringify(messages);
    seen.set(key, (seen.get(key) || 0) + 1);
    if (task === "check-global" && failure) { failure = false; throw codedError("NETWORK"); }
    return answer("已核对。");
  };
  await review.run(session, options(request));
  assert.match(session.globalError, /NETWORK/);
  assert.ok(session.parts.every((part) => part.status === "done"));
  await review.run(session, options(request));
  assert.equal(review.isComplete(session), true);
  for (const part of session.parts) assert.equal(seen.get(JSON.stringify(review.messagesForPart(session, part))), 1);
});

test("a repeatedly truncated global combination stops after bounded reduction rounds", async () => {
  const session = create("int value = 1;\n".repeat(300));
  let calls = 0;
  await review.run(session, options(async (messages, task) => {
    calls += 1;
    if (task === "check-global") {
      const reportText = messages[1].content.split("各段检查结果：\n")[1].split("\n请复核")[0];
      if (JSON.parse(reportText).length > 1) throw codedError("OUTPUT_LIMIT");
    }
    return answer("本段已核对。");
  }));
  assert.ok(calls < 20);
  assert.equal(review.isComplete(session), false);
  assert.match(session.globalError, /多次达到输出上限/);
});

test("followup subdivisions do not schedule the original failed range again", async () => {
  const session = create("int value = 1;\n".repeat(300));
  let failed = false;
  let calls = 0;
  await review.run(session, options(async (messages, task) => {
    calls += 1;
    if (calls > 30) throw codedError("AUTH");
    if (task === "check-global") return answer("需要关联核对。", [], [{ startLine: 1, endLine: 79, reason: "检查关联实现" }]);
    if (messages[1].content.includes("关联复核目标") && !failed) { failed = true; throw codedError("OUTPUT_LIMIT"); }
    return answer();
  }));
  assert.equal(review.isComplete(session), true);
  assert.ok(session.followups.length > 1);
  assert.ok(session.followups.every((part) => part.status === "done" && part.end - part.start < 79 * 15));
  assert.ok(calls < 15);
});

test("linked-code review receives the requesting code as well as the requested code", async () => {
  const session = create("int caller() { return callee(); }\n" + "int value = 1;\n".repeat(300) + "int callee() { return 1; }");
  let requested = false;
  let linked = false;
  await review.run(session, options(async (messages, task) => {
    if (task === "check-global") return answer();
    if (messages[1].content.includes("关联复核目标")) {
      linked = true;
      assert.match(messages[1].content, /int caller\(\) \{ return callee\(\); \}/);
      assert.match(messages[1].content, /int callee\(\) \{ return 1; \}/);
    } else if (!requested) {
      requested = true;
      return answer("需确认返回值。", [], [{ startLine: 302, endLine: 302, reason: "核对 caller 调用 callee 的返回值" }]);
    }
    return answer();
  }));
  assert.equal(linked, true);
  assert.equal(review.isComplete(session), true);
});

test("completed subdivisions jointly satisfy a related-code range", () => {
  const session = create("int value = 1;\n".repeat(20));
  session.parts.forEach((part) => { part.status = "done"; });
  session.global = { summary: "已核对。", issues: [], needsContext: [] };
  session.followups = [
    { start: 0, end: session.offsets[1], status: "done", result: { needsContext: [{ startLine: 5, endLine: 10 }] } },
    { start: session.offsets[4], end: session.offsets[7], status: "done", result: { needsContext: [] } },
    { start: session.offsets[7], end: session.offsets[10], status: "done", result: { needsContext: [] } }
  ];
  assert.equal(review.isComplete(session), true);
  session.followups[2].start += 1;
  assert.equal(review.isComplete(session), false);
});
