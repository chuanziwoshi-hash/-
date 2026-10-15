const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function loadSnapshotFunction() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "background", "background.js"),
    "utf8"
  );
  const start = source.indexOf("async function captureLeetCodeCodeSnapshotInMainWorld()");
  const end = source.indexOf("\nasync function testProblemSource()", start);

  assert.notEqual(start, -1, "snapshot function should exist");
  assert.notEqual(end, -1, "snapshot function boundary should exist");
  return Function(`return (${source.slice(start, end).trim()});`)();
}

function createCodeMirrorDocument(lines) {
  const lineNodes = lines.map((text) => ({ textContent: text }));
  const target = {
    // This deliberately models the unstable browser serialization that caused
    // each snapshot/restore cycle to multiply blank lines.
    innerText: lines.join("\n\n"),
    textContent: lines.join(""),
    closest() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === ".cm-line" ? lineNodes : [];
    }
  };
  const editor = {
    getBoundingClientRect() {
      return { width: 800, height: 600 };
    },
    querySelector() {
      return target;
    }
  };

  return {
    querySelectorAll(selector) {
      return selector === ".cm-editor" ? [editor] : [];
    }
  };
}

test("CodeMirror snapshots read logical lines without multiplying newlines", async () => {
  const captureSnapshot = loadSnapshotFunction();
  const originalWindow = global.window;
  const originalDocument = global.document;

  global.window = {
    getComputedStyle() {
      return { display: "block", visibility: "visible" };
    }
  };
  global.document = createCodeMirrorDocument([
    "class Solution {",
    "  solve() {}",
    "}",
    ""
  ]);

  try {
    const snapshot = await captureSnapshot();
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.method, "dom");
    assert.equal(snapshot.text, "class Solution {\n  solve() {}\n}\n");

    global.document = createCodeMirrorDocument(snapshot.text.split("\n"));
    const nextSnapshot = await captureSnapshot();
    assert.equal(nextSnapshot.text, snapshot.text);
  } finally {
    global.window = originalWindow;
    global.document = originalDocument;
  }
});
