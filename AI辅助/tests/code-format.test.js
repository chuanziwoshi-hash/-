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

test("formats manually written single-line C++ code", () => {
  const core = loadCore();
  const formatted = core.formatCode("int main(){int x=1;if(x){x++;}return 0;}", "cpp17");

  assert.equal(formatted, [
    "int main() {",
    "    int x = 1;",
    "    if (x) {",
    "        x++;",
    "    }",
    "    return 0;",
    "}"
  ].join("\n"));
});

test("does not split for-loop semicolons or string contents", () => {
  const core = loadCore();
  const formatted = core.formatCode('for (int i=0;i<3;i++){cout << "{;}";}', "cpp17");

  assert.equal(formatted, [
    "for (int i = 0; i<3; i++) {",
    '    cout << "{;}";',
    "}"
  ].join("\n"));
});

test("ignores braces in comments while calculating indentation", () => {
  const core = loadCore();
  const formatted = core.formatCode("int main(){// }\nreturn 0;}", "cpp17");

  assert.equal(formatted, [
    "int main() {",
    "    // }",
    "    return 0;",
    "}"
  ].join("\n"));
});

test("keeps the cursor near the same token after formatting", () => {
  const core = loadCore();
  const before = "int main(){return 0;}";
  const after = core.formatCode(before, "cpp17");
  const beforeOffset = before.indexOf("return") + "return".length;
  const afterOffset = core.mapFormattedOffset(before, after, beforeOffset);

  assert.equal(afterOffset, after.indexOf("return") + "return".length);
});

test("preserves Python dedent levels while normalizing indentation", () => {
  const core = loadCore();
  const formatted = core.formatCode([
    "def solve():",
    "  if ready:",
    "      run()",
    "  finish()",
    "print('done')"
  ].join("\n"), "python");

  assert.equal(formatted, [
    "def solve():",
    "    if ready:",
    "        run()",
    "    finish()",
    "print('done')"
  ].join("\n"));
});

test("formatting is idempotent", () => {
  const core = loadCore();
  const once = core.formatCode("int main(){for(int i=0;i<3;i++){work(i);}}", "cpp17");
  const twice = core.formatCode(once, "cpp17");

  assert.equal(twice, once);
});

test("normalizes safe internal operator spacing", () => {
  const core = loadCore();
  const formatted = core.formatCode("int a=1;if(a==1&&ready!=false){a+=2;}", "cpp17");

  assert.equal(formatted, [
    "int a = 1;",
    "if (a == 1 && ready != false) {",
    "    a += 2;",
    "}"
  ].join("\n"));
});

test("does not format operators inside strings or comments", () => {
  const core = loadCore();
  const formatted = core.formatCode('int a=1; // keep a=1\nstring s="a=1&&b=2";', "cpp17");

  assert.equal(formatted, [
    "int a = 1;",
    "// keep a=1",
    'string s = "a=1&&b=2";'
  ].join("\n"));
});

test("keeps pointer declarators intact", () => {
  const core = loadCore();
  assert.equal(core.formatCode("int *p=&value;", "cpp17"), "int *p = &value;");
});
