const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadCore() {
  const source = fs.readFileSync(path.join(__dirname, "..", "content", "assistant-core.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.CodingAssistantCore;
}

test("applyTextChange uses the captured range", () => {
  const core = loadCore();
  assert.equal(core.applyTextChange("one\ntwo\nthree", 4, 7, "TWO"), "one\nTWO\nthree");
});

test("prependStatusMessage keeps the explanation below the insertion status", () => {
  const core = loadCore();

  assert.equal(
    core.prependStatusMessage("已撤销改动。", "第 2 行存在边界问题。"),
    "已撤销改动。\n\n第 2 行存在边界问题。"
  );
  assert.equal(core.prependStatusMessage("已撤销改动。", ""), "已撤销改动。");
  assert.equal(core.prependStatusMessage("", "原代码解释"), "原代码解释");
});

test("buildTextDiff reports a single-line replacement", () => {
  const core = loadCore();
  const diff = core.buildTextDiff("one\ntwo\nthree", "one\nTWO\nthree");

  assert.equal(diff.changed, true);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(
    Array.from(diff.lines, (line) => [line.type, line.oldNumber, line.newNumber, line.text]),
    [
      ["context", 1, 1, "one"],
      ["removed", 2, null, "two"],
      ["added", null, 2, "TWO"],
      ["context", 3, 3, "three"]
    ]
  );
});

test("buildTextDiff renders insertion into an empty editor as additions", () => {
  const core = loadCore();
  const diff = core.buildTextDiff("", "alpha\nbeta");

  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 0);
  assert.deepEqual(Array.from(diff.lines, (line) => line.type), ["added", "added"]);
});

test("buildTextDiff preserves all unchanged context", () => {
  const core = loadCore();
  const before = ["1", "2", "3", "4", "5", "6", "7"].join("\n");
  const after = ["1", "2", "3", "FOUR", "5", "6", "7"].join("\n");
  const diff = core.buildTextDiff(before, after);

  assert.deepEqual(Array.from(diff.lines, (line) => line.type), [
    "context",
    "context",
    "context",
    "removed",
    "added",
    "context",
    "context",
    "context"
  ]);
});

test("long diffs preserve every line and both documents can be reconstructed", () => {
  const core = loadCore();
  const oldLines = Array.from({ length: 6000 }, (_, index) => "line " + (index + 1));
  oldLines[100] = "...";
  oldLines[5998] = "a".repeat(30000);
  const before = oldLines.join("\n") + "\n";
  const newLines = oldLines.slice();
  newLines.splice(3000, 1, "replacement", "inserted line");
  const after = newLines.join("\n") + "\n";
  const diff = core.buildTextDiff(before, after);

  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.equal(diff.lines.length, 6003);
  assert.equal(diff.lines.some((line) => line.type === "separator"), false);
  assert.equal(Array.from(diff.lines).filter((line) => line.type !== "added").map((line) => line.text).join("\n"), before);
  assert.equal(Array.from(diff.lines).filter((line) => line.type !== "removed").map((line) => line.text).join("\n"), after);
  assert.equal(diff.lines[0].oldNumber, 1);
  assert.equal(diff.lines.at(-1).oldNumber, 6001);
  assert.equal(diff.lines.at(-1).newNumber, 6002);
});

test("unchanged long code remains visible in full", () => {
  const core = loadCore();
  const text = Array.from({ length: 1000 }, (_, index) => "line " + (index + 1)).join("\n");
  const diff = core.buildTextDiff(text, text);

  assert.equal(diff.changed, false);
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
  assert.equal(diff.lines.length, 1000);
  assert.equal(Array.from(diff.lines, (line) => line.text).join("\n"), text);
});
