const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function loadRestoreValueFunction() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "content", "content-script.js"),
    "utf8"
  );
  const start = source.indexOf("function restorePageContentEditableValue(target, snapshot)");
  const end = source.indexOf("\n\n  async function restoreCodeMirrorInsertSnapshot", start);

  assert.notEqual(start, -1, "contenteditable restore helper should exist");
  assert.notEqual(end, -1, "contenteditable restore helper boundary should exist");
  return Function(`return (${source.slice(start, end).trim()});`)();
}

function loadNamedFunction(name, nextName) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "content", "content-script.js"),
    "utf8"
  );
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`\n\n  function ${nextName}`, start);

  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${name} boundary should exist`);
  return Function(`return (${source.slice(start, end).trim()});`)();
}

test("contenteditable undo restores the original editor markup", () => {
  const restoreValue = loadRestoreValueFunction();
  const writes = [];
  const target = {
    set innerHTML(value) {
      writes.push(["html", value]);
    },
    set textContent(value) {
      writes.push(["text", value]);
    }
  };
  const snapshot = {
    html: '<div class="cm-line">first</div><div class="cm-line">second</div>',
    text: "first\nsecond"
  };

  restoreValue(target, snapshot);

  assert.deepEqual(writes, [["html", snapshot.html]]);
});

test("legacy text-only snapshots still restore", () => {
  const restoreValue = loadRestoreValueFunction();
  const target = { textContent: "changed" };

  restoreValue(target, { text: "before" });

  assert.equal(target.textContent, "before");
});

test("CodeMirror snapshots serialize each logical line exactly once", () => {
  const readText = loadNamedFunction(
    "readPageContentEditableText(target)",
    "restorePageContentEditableValue"
  );
  const target = {
    innerText: "first\n\nsecond",
    querySelectorAll(selector) {
      return selector === ".cm-line"
        ? [{ textContent: "first" }, { textContent: "second" }]
        : [];
    }
  };

  assert.equal(readText(target), "first\nsecond");
});
