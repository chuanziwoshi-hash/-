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

test("removes line and block comments from inserted C++ suggestions", () => {
  const core = loadCore();
  const suggestion = [
    "int a = 1; // initialize",
    "/* update the answer */",
    "a += 2;"
  ].join("\n");

  assert.equal(core.stripCodeComments(suggestion, "cpp17"), "int a = 1;\n\na += 2;");
});

test("preserves comment markers inside strings", () => {
  const core = loadCore();
  const suggestion = 'string url = "https://example.com/a/*b*/"; // remove';

  assert.equal(
    core.stripCodeComments(suggestion, "cpp17"),
    'string url = "https://example.com/a/*b*/";'
  );
});

test("removes Python comments without changing hash characters in strings", () => {
  const core = loadCore();
  const suggestion = 'value = "#keep" # remove\n# full line\nprint(value)';

  assert.equal(core.stripCodeComments(suggestion, "python"), 'value = "#keep"\n\nprint(value)');
});

test("keeps C++ preprocessor directives", () => {
  const core = loadCore();
  const suggestion = "#include <bits/stdc++.h>\n#define LIMIT 10 // remove\nint a = LIMIT;";

  assert.equal(
    core.stripCodeComments(suggestion, "cpp17"),
    "#include <bits/stdc++.h>\n#define LIMIT 10\nint a = LIMIT;"
  );
});

test("removes HTML comments", () => {
  const core = loadCore();
  assert.equal(core.stripCodeComments("<main><!-- note --><span>ok</span></main>", "html"), "<main> <span>ok</span></main>");
});
