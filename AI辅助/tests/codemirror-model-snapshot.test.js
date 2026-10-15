const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "..", "background", "background.js"),
  "utf8"
);

function loadFunction(name, nextName) {
  const start = backgroundSource.indexOf(`function ${name}`);
  const end = backgroundSource.indexOf(`\n\nfunction ${nextName}`, start);

  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${name} boundary should exist`);
  return Function(`return (${backgroundSource.slice(start, end).trim()});`)();
}

function createEditor(text, anchor = 0, head = anchor, binding = "cmTile") {
  const view = {
    state: {
      doc: {
        length: text.length,
        toString: () => text
      },
      selection: { main: { anchor, head } }
    },
    dispatch(spec) {
      text = text.slice(0, spec.changes.from) + spec.changes.insert + text.slice(spec.changes.to);
      this.state = {
        doc: {
          length: text.length,
          toString: () => text
        },
        selection: {
          main: {
            anchor: spec.selection.anchor,
            head: spec.selection.head
          }
        }
      };
    },
    focus() {}
  };
  const target = {
    matches(selector) {
      return selector === ".cm-content[contenteditable='true']";
    },
    parentElement: null
  };
  target[binding] = binding === "cmTile" ? { view } : { view };

  return { target, view };
}

test("captures CodeMirror text and selection from the editor model", () => {
  const capture = loadFunction(
    "captureCodeMirrorCodeSnapshotInMainWorld()",
    "insertCodeMirrorCodeInMainWorld"
  );
  const originalDocument = global.document;
  const { target } = createEditor("line 1\nline 2", 7, 12);
  global.document = { activeElement: target };

  try {
    assert.deepEqual(capture(), {
      ok: true,
      method: "codemirror-state",
      text: "line 1\nline 2",
      anchor: 7,
      head: 12
    });
  } finally {
    global.document = originalDocument;
  }
});

test("captures CodeMirror through the legacy cmView binding", () => {
  const capture = loadFunction(
    "captureCodeMirrorCodeSnapshotInMainWorld()",
    "insertCodeMirrorCodeInMainWorld"
  );
  const originalDocument = global.document;
  const { target } = createEditor("legacy", 3, 3, "cmView");
  global.document = { activeElement: target };

  try {
    assert.equal(capture().text, "legacy");
  } finally {
    global.document = originalDocument;
  }
});

test("restores an empty CodeMirror document through one model transaction", () => {
  const restore = loadFunction(
    "restoreCodeMirrorCodeSnapshotInMainWorld(snapshot)",
    "prepareLeetCodeInsertText"
  );
  const originalDocument = global.document;
  const { target, view } = createEditor("inserted\ncode", 13);
  global.document = { activeElement: target };

  try {
    const result = restore({ text: "", anchor: 0, head: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.text, "");
    assert.equal(view.state.doc.length, 0);
    assert.deepEqual(view.state.selection.main, { anchor: 0, head: 0 });
  } finally {
    global.document = originalDocument;
  }
});

test("insertion and undo use the same CodeMirror model coordinates", () => {
  const capture = loadFunction(
    "captureCodeMirrorCodeSnapshotInMainWorld()",
    "insertCodeMirrorCodeInMainWorld"
  );
  const insert = loadFunction(
    "insertCodeMirrorCodeInMainWorld(payload)",
    "restoreCodeMirrorCodeSnapshotInMainWorld"
  );
  const restore = loadFunction(
    "restoreCodeMirrorCodeSnapshotInMainWorld(snapshot)",
    "prepareLeetCodeInsertText"
  );
  const originalDocument = global.document;
  const { target, view } = createEditor("ab\ncd", 3, 3);
  global.document = { activeElement: target };

  try {
    const snapshot = capture();
    const inserted = insert({
      beforeText: snapshot.text,
      text: "X\nY",
      anchor: snapshot.anchor,
      head: snapshot.head
    });

    assert.equal(inserted.ok, true);
    assert.equal(view.state.doc.toString(), "ab\nX\nYcd");
    assert.deepEqual(view.state.selection.main, { anchor: 6, head: 6 });

    const restored = restore(snapshot);
    assert.equal(restored.ok, true);
    assert.equal(view.state.doc.toString(), "ab\ncd");
    assert.deepEqual(view.state.selection.main, { anchor: 3, head: 3 });
  } finally {
    global.document = originalDocument;
  }
});

test("insertion replaces the captured selection and rejects a stale snapshot", () => {
  const insert = loadFunction(
    "insertCodeMirrorCodeInMainWorld(payload)",
    "restoreCodeMirrorCodeSnapshotInMainWorld"
  );
  const originalDocument = global.document;
  const { target, view } = createEditor("abcdef", 1, 4);
  global.document = { activeElement: target };

  try {
    const inserted = insert({ beforeText: "abcdef", text: "X", anchor: 1, head: 4 });
    assert.equal(inserted.ok, true);
    assert.equal(view.state.doc.toString(), "aXef");
    assert.deepEqual(view.state.selection.main, { anchor: 2, head: 2 });

    const stale = insert({ beforeText: "abcdef", text: "Y", anchor: 0, head: 0 });
    assert.equal(stale.ok, false);
    assert.match(stale.error, /changed/);
    assert.equal(view.state.doc.toString(), "aXef");
  } finally {
    global.document = originalDocument;
  }
});
