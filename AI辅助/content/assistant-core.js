(function () {
  const PROBLEM_TEXT_LIMIT = 30000;

  const LANG_NAMES = {
    auto: "自动识别",
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    cpp98: "C++98",
    cpp11: "C++11",
    cpp14: "C++14",
    cpp17: "C++17",
    cpp20: "C++20",
    java8: "Java 8",
    java11: "Java 11",
    java17: "Java 17",
    c: "C",
    csharp: "C#",
    go: "Go",
    html: "HTML",
    css: "CSS"
  };

  function langName(language) {
    return LANG_NAMES[language] || "自动识别";
  }

  function detectLanguage(text, selectedLanguage) {
    if (selectedLanguage && selectedLanguage !== "auto") {
      return selectedLanguage;
    }

    const source = String(text || "");
    const lower = source.toLowerCase();

    if (looksLikeCpp(source, lower)) {
      return "cpp17";
    }

    if (looksLikeJava(source)) {
      return "java17";
    }

    if (lower.includes("python") || /^\s*(def|for|if|while)\s+/m.test(source) || /^\s*class\s+\w+\s*:/m.test(source) || source.includes("print(")) {
      return "python";
    }

    if (/\bpackage\s+main\b/.test(source) || /\bfunc\s+main\s*\(/.test(source)) {
      return "go";
    }

    if (/\busing\s+System\b/.test(source) || /\bConsole\.Write(Line)?\b/.test(source)) {
      return "csharp";
    }

    if (lower.includes("typescript") || /\binterface\s+\w+\s*\{/.test(source) || /:\s*(string|number|boolean)\b/.test(source)) {
      return "typescript";
    }

    if (lower.includes("html") || /<\/?[a-z][\s\S]*>/i.test(source)) {
      return "html";
    }

    if (lower.includes("css") || /[.#][\w-]+\s*\{/.test(source)) {
      return "css";
    }

    return "javascript";
  }

  function looksLikeCpp(source, lower) {
    return lower.includes("c++") ||
      lower.includes("cpp") ||
      source.includes("#include") ||
      /\bint\s+main\s*\(/.test(source) ||
      /\bstd::\w+/.test(source) ||
      /\b(?:vector|string|unordered_map|unordered_set|map|set|queue|stack|priority_queue|pair)\s*</.test(source) ||
      /\b(?:ListNode|TreeNode)\s*\*/.test(source) ||
      /\bnullptr\b/.test(source) ||
      /\blong\s+long\b/.test(source) ||
      /^\s*class\s+Solution\s*\{[\s\S]*?\b(?:public|private|protected)\s*:/m.test(source);
  }

  function looksLikeJava(source) {
    return /\bpublic\s+class\b/.test(source) ||
      /System\.out\.println/.test(source) ||
      /import\s+java\./.test(source) ||
      /new\s+Scanner\s*\(/.test(source) ||
      /^\s*class\s+Solution\s*\{[\s\S]*?\bpublic\s+(?:int|long|boolean|double|String|List<|TreeNode|ListNode|void)\b/m.test(source);
  }

  function buildMessages(params) {
    const mode = params.mode || "next";
    const problem = compactText(params.problem, PROBLEM_TEXT_LIMIT);
    const fullCode = compactText(params.code, 20000);
    const fullCodeWithLineNumbers = compactText(params.fullCodeWithLineNumbers, 22000);
    const codeBeforeCursor = compactText(params.codeBeforeCursor, 16000);
    const codeAfterCursor = compactText(params.codeAfterCursor, 5000);
    const selectedCode = compactText(params.selectedCode, 12000);
    const cursorLine = Number(params.cursorLine) || 1;
    const cursorColumn = Number(params.cursorColumn) || 1;
    const selectionStartLine = Number(params.selectionStartLine) || 1;
    const selectionStartColumn = Number(params.selectionStartColumn) || 1;
    const selectionEndLine = Number(params.selectionEndLine) || selectionStartLine;
    const selectionEndColumn = Number(params.selectionEndColumn) || selectionStartColumn;
    const suggestionScopeLabel = compactText(params.suggestionScopeLabel, 120) || "只补光标处一小段";
    const suggestionScopeInstruction = compactText(params.suggestionScopeInstruction, 300);
    const suggestionScopeContext = compactText(params.suggestionScopeContext, 9000);
    const lastResult = compactText(params.lastResult, 3000);
    const language = detectLanguage(problem + "\n" + fullCode, params.language);

    const system = [
      "你是一个实时编程教练，帮助用户在代码编辑框中继续写代码并检查错误。",
      "必须使用简体中文回答。只根据题目上下文和用户当前代码判断，不要编造题目没有要求的输入输出。",
      "如果当前代码明显不完整，优先指出下一步应该补哪一小段，而不是直接重写整份答案。",
      "涉及代码时，代码必须匹配当前语言和现有变量命名。"
    ].join("\n");

    if (mode === "next") {
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "建议范围：" + suggestionScopeLabel,
            suggestionScopeInstruction ? "范围约束：" + suggestionScopeInstruction : "",
            "目标语言：" + langName(language),
            "题目上下文：",
            problem || "没有读取到题目上下文，请只根据当前代码给出谨慎建议。",
            "",
            "光标位置：第 " + cursorLine + " 行，第 " + cursorColumn + " 列。",
            "当前完整代码（带行号，仅用于定位；不要把行号写进建议代码）：",
            fullCodeWithLineNumbers || "空",
            "",
            "光标前代码：",
            codeBeforeCursor || "空",
            "",
            "光标后代码：",
            codeAfterCursor || "空",
            "",
            "上一次结果：",
            lastResult || "无",
            "",
            "请判断用户现在最应该继续写哪一段。",
            "输出格式固定为：",
            "下一步说明：用 1 到 3 句话说明为什么写这一段；如果当前位置附近有问题，标出第几行。",
            "建议代码：只给接下来应该插入到光标位置的一小段代码，不要包含行号，不要给完整程序，除非当前代码为空且必须先搭框架。",
            "注意事项：列出当前这一步容易写错的点；能定位到代码时写明第几行。"
          ].join("\n")
        }
      ];
    }

    if (mode === "check") {
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "目标语言：" + langName(language),
            "题目上下文：",
            problem || "没有读取到题目上下文，请只检查代码本身的语法和明显逻辑问题。",
            "",
            "当前完整代码（带行号）：",
            fullCodeWithLineNumbers || fullCode || "空",
            "",
            "请检查光标之前和已有代码是否有错误。",
            "输出格式固定为：",
            "检查结论：一句话说明是否发现问题。",
            "问题列表：按严重程度列出语法错误、变量错误、输入输出不匹配、边界情况、复杂度风险；每个能定位的问题必须标注“第 N 行”。",
            "修改建议：给出最小修改方案；涉及具体代码时标注“第 N 行”。",
            "如果没有发现明确错误，不要硬凑问题，只说明还需要哪些测试样例验证。"
          ].join("\n")
        }
      ];
    }

    if (mode === "explain-selection") {
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "目标语言：" + langName(language),
            "题目上下文：",
            problem || "没有读取到题目上下文；请只根据代码本身解释，不要编造题意。",
            "",
            "选中范围：第 " + selectionStartLine + " 行第 " + selectionStartColumn + " 列 到 第 " + selectionEndLine + " 行第 " + selectionEndColumn + " 列",
            "选中代码：",
            selectedCode || "空",
            "",
            "完整代码（带行号，仅用于定位）：",
            fullCodeWithLineNumbers || fullCode || "空",
            "",
            "请解释用户选中的代码，不要改写代码，除非指出风险时需要给出很短的示例。",
            "输出格式固定为：",
            "作用概览：用 1 到 2 句话说明这段代码整体在做什么。",
            "逐段说明：按执行顺序解释关键语句；能定位时标注第 N 行。",
            "关键变量：说明这段代码里最重要的变量或状态变化。",
            "边界与风险：指出可能出错的边界条件、空值、越界、复杂度或语言细节。",
            "和题目的关系：如果题目上下文足够，说明这段代码服务于哪一步算法；否则写“题目上下文不足”。"
          ].join("\n")
        }
      ];
    }

    return [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          "目标语言：" + langName(language),
          "题目上下文：",
          problem || "没有读取到题目上下文。",
          "",
          "当前代码：",
          fullCode || "空",
          "",
          "请简要解释当前代码状态，并说明下一步。"
        ].join("\n")
      }
    ];
  }

  function compactText(value, maxLength) {
    const text = String(value || "").trim();

    if (text.length <= maxLength) {
      return text;
    }

    return text.slice(0, maxLength) + "\n[内容过长，后续部分已省略]";
  }

  function extractSuggestedCode(answer) {
    const text = String(answer || "").trim();
    const marker = "建议代码：";
    const markerIndex = text.indexOf(marker);

    if (markerIndex < 0) {
      return stripCodeFence(text);
    }

    const rest = text.slice(markerIndex + marker.length).trim();
    const nextMarkerMatch = rest.match(/\n(?:注意事项|检查结论|问题列表|修改建议)：/);
    const code = nextMarkerMatch ? rest.slice(0, nextMarkerMatch.index).trim() : rest;

    return stripCodeFence(code);
  }

  function stripCodeFence(value) {
    return String(value || "")
      .replace(/^```[a-zA-Z0-9+#-]*\s*/g, "")
      .replace(/```$/g, "")
      .trim();
  }

  function stripCodeComments(value, language) {
    const source = String(value || "").replace(/\r\n?/g, "\n");
    const resolvedLanguage = !language || language === "auto"
      ? detectLanguage(source, "auto")
      : String(language).toLowerCase();
    const pythonComments = resolvedLanguage === "python";
    let result = "";
    let quote = "";
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    let inHtmlComment = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (inLineComment) {
        if (char === "\n") {
          result = result.replace(/[ \t]+$/, "") + "\n";
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (char === "\n") {
          result = result.replace(/[ \t]+$/, "") + "\n";
          continue;
        }
        if (char === "*" && next === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (inHtmlComment) {
        if (char === "\n") {
          result = result.replace(/[ \t]+$/, "") + "\n";
          continue;
        }
        if (source.startsWith("-->", index)) {
          inHtmlComment = false;
          index += 2;
        }
        continue;
      }

      if (quote) {
        result += char;
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (source.startsWith("<!--", index)) {
        appendCommentSpacer();
        inHtmlComment = true;
        index += 3;
        continue;
      }

      if (char === "/" && next === "*") {
        appendCommentSpacer();
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "/" && next === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (pythonComments && char === "#") {
        inLineComment = true;
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        result += char;
        continue;
      }

      result += char;
    }

    return finalizeCode(result
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n"));

    function appendCommentSpacer() {
      if (result && !/\s$/.test(result)) {
        result += " ";
      }
    }
  }

  function normalizeProblemPayload(payload) {
    if (!payload) {
      return "";
    }

    if (typeof payload === "string") {
      return payload.trim();
    }

    const candidates = [
      payload.problem,
      payload.question,
      payload.description,
      payload.content,
      payload.context,
      payload.text,
      payload.data && payload.data.problem,
      payload.data && payload.data.question,
      payload.data && payload.data.description,
      payload.data && payload.data.content
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return "";
  }

  function applyTextChange(value, start, end, replacement) {
    const text = String(value || "");
    const safeStart = Math.max(0, Math.min(Number(start) || 0, text.length));
    const safeEnd = Math.max(safeStart, Math.min(Number(end) || 0, text.length));

    return text.slice(0, safeStart) + String(replacement || "") + text.slice(safeEnd);
  }

  function prependStatusMessage(status, previousText) {
    const statusText = String(status || "").trim();
    const restoredText = String(previousText || "");

    if (!statusText) return restoredText;
    if (!restoredText) return statusText;
    return statusText + "\n\n" + restoredText;
  }

  function buildTextDiff(beforeValue, afterValue) {
    const before = String(beforeValue || "").replace(/\r\n?/g, "\n");
    const after = String(afterValue || "").replace(/\r\n?/g, "\n");
    const oldLines = splitDiffLines(before);
    const newLines = splitDiffLines(after);
    let prefix = 0;

    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
      prefix += 1;
    }

    let suffix = 0;
    while (
      suffix < oldLines.length - prefix &&
      suffix < newLines.length - prefix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const oldChangeEnd = oldLines.length - suffix;
    const newChangeEnd = newLines.length - suffix;
    const lines = [];

    for (let index = 0; index < prefix; index += 1) {
      lines.push(createDiffLine("context", index + 1, index + 1, oldLines[index]));
    }

    for (let index = prefix; index < oldChangeEnd; index += 1) {
      lines.push(createDiffLine("removed", index + 1, null, oldLines[index]));
    }

    for (let index = prefix; index < newChangeEnd; index += 1) {
      lines.push(createDiffLine("added", null, index + 1, newLines[index]));
    }

    for (let offset = 0; offset < suffix; offset += 1) {
      const oldIndex = oldChangeEnd + offset;
      const newIndex = newChangeEnd + offset;
      lines.push(createDiffLine("context", oldIndex + 1, newIndex + 1, oldLines[oldIndex]));
    }

    return {
      changed: before !== after,
      added: Math.max(0, newChangeEnd - prefix),
      removed: Math.max(0, oldChangeEnd - prefix),
      lines
    };
  }

  function splitDiffLines(value) {
    return value === "" ? [] : value.split("\n");
  }

  function createDiffLine(type, oldNumber, newNumber, text) {
    return { type, oldNumber, newNumber, text };
  }

  function formatCode(value, language) {
    const code = normalizeCode(value);
    const normalizedLanguage = String(language || "").toLowerCase();
    const unit = ["javascript", "typescript", "html", "css"].includes(normalizedLanguage) ? "  " : "    ";

    if (!code.trim()) {
      return "";
    }

    if (normalizedLanguage === "python") {
      return formatPythonCode(code, unit);
    }

    if (isBraceLanguage(normalizedLanguage)) {
      return formatBraceCode(code, unit);
    }

    return finalizeCode(code
      .split("\n")
      .map((line) => line.replace(/\t/g, unit).replace(/[ \t]+$/g, ""))
      .join("\n"));
  }

  function mapFormattedOffset(beforeValue, afterValue, offset) {
    const before = String(beforeValue || "");
    const after = String(afterValue || "");
    const safeOffset = Math.max(0, Math.min(Number(offset) || 0, before.length));
    const significantBefore = before.slice(0, safeOffset).replace(/\s/g, "").length;

    if (significantBefore === 0) {
      return 0;
    }

    let seen = 0;
    for (let index = 0; index < after.length; index += 1) {
      if (!/\s/.test(after[index])) {
        seen += 1;
      }

      if (seen >= significantBefore) {
        return index + 1;
      }
    }

    return after.length;
  }

  function normalizeCode(value) {
    return String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function isBraceLanguage(language) {
    return new Set([
      "c", "cpp98", "cpp11", "cpp14", "cpp17", "cpp20", "csharp", "css", "go",
      "java8", "java11", "java17", "javascript", "typescript"
    ]).has(language);
  }

  function formatBraceCode(code, unit) {
    const lines = splitBraceStatements(code);
    const result = [];
    const state = { inBlockComment: false };
    const spacingState = { inBlockComment: false, quote: "", escaped: false };
    let indentLevel = 0;
    let previousWasBlank = false;

    for (const rawLine of lines) {
      const trimmed = rawLine.replace(/\t/g, unit).trim();

      if (!trimmed) {
        if (!previousWasBlank && result.length > 0) {
          result.push("");
          previousWasBlank = true;
        }
        continue;
      }

      const spacedLine = normalizeBraceLineSpacing(trimmed, spacingState);
      const structureLine = stripFormattingNoise(spacedLine, state);
      let currentIndent = indentLevel;

      if (/^}/.test(spacedLine)) {
        currentIndent -= 1;
      }

      if (/^(public|private|protected)\s*:\s*$/.test(spacedLine) || /^(case\b[\s\S]*:|default\s*:)\s*$/.test(spacedLine)) {
        currentIndent -= 1;
      }

      if (/^#\s*[A-Za-z_]/.test(spacedLine)) {
        currentIndent = 0;
      }

      currentIndent = Math.max(0, currentIndent);
      result.push(unit.repeat(currentIndent) + spacedLine);
      previousWasBlank = false;

      const braceDelta = countCharacter(structureLine, "{") - countCharacter(structureLine, "}");
      indentLevel = Math.max(0, indentLevel + braceDelta);

      if (/^(public|private|protected)\s*:\s*$/.test(spacedLine) || /^(case\b[\s\S]*:|default\s*:)\s*$/.test(spacedLine)) {
        indentLevel = Math.max(indentLevel, currentIndent + 1);
      }
    }

    return finalizeCode(result.join("\n"));
  }

  function normalizeBraceLineSpacing(line, state) {
    if (/^#\s*[A-Za-z_]/.test(line)) {
      return line;
    }

    let result = "";
    let code = "";

    const flushCode = () => {
      result += normalizeCodeSegmentSpacing(code);
      code = "";
    };

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (state.inBlockComment) {
        result += char;
        if (char === "*" && next === "/") {
          result += next;
          state.inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (state.quote) {
        result += char;
        if (state.escaped) {
          state.escaped = false;
        } else if (char === "\\") {
          state.escaped = true;
        } else if (char === state.quote) {
          state.quote = "";
        }
        continue;
      }

      if (char === "/" && next === "/") {
        flushCode();
        const comment = line.slice(index);
        result = result.replace(/[ \t]*$/, result.trim() ? " " : "") + comment;
        return result.trimEnd();
      }

      if (char === "/" && next === "*") {
        flushCode();
        if (result && !/\s$/.test(result)) result += " ";
        result += "/*";
        state.inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        flushCode();
        state.quote = char;
        result += char;
        continue;
      }

      code += char;
    }

    flushCode();
    return result.trim();
  }

  function normalizeCodeSegmentSpacing(value) {
    const operatorPattern = /(===|!==|<<=|>>=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|==|!=|<=|>=|&&|\|\||=>|=)/g;
    let text = String(value || "")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .replace(operatorPattern, " $1 ")
      .replace(/;\s*/g, "; ")
      .replace(/\b(if|for|while|switch|catch)\s*\(/g, "$1 (")
      .replace(/\s*\{$/, " {")
      .replace(/[ \t]+/g, " ");

    text = text.replace(/([\w)\]])\s*([+\-/%])\s*([\w(\[])/g, (match, left, operator, right, offset, source) => {
      const previousWord = source.slice(0, offset + 1).match(/([A-Za-z_]\w*)$/);
      if (previousWord && /^(return|throw|case|new|delete|sizeof)$/.test(previousWord[1])) {
        return match;
      }
      return left + " " + operator + " " + right;
    });
    return text;
  }

  function splitBraceStatements(code) {
    const result = [];
    let buffer = "";
    let quote = "";
    let escaped = false;
    let inBlockComment = false;
    let inLineComment = false;
    let inPreprocessor = false;
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let lineHasContent = false;

    const flush = () => {
      const text = buffer.trim();
      if (text) {
        result.push(text);
        lineHasContent = true;
      }
      buffer = "";
    };

    for (let index = 0; index < code.length; index += 1) {
      const char = code[index];
      const next = code[index + 1];

      if (char === "\n") {
        flush();
        if (!lineHasContent && result[result.length - 1] !== "") {
          result.push("");
        }
        lineHasContent = false;
        inLineComment = false;
        inPreprocessor = false;
        buffer = "";
        continue;
      }

      if (!lineHasContent && !buffer.trim() && char === "#" && !quote && !inBlockComment) {
        inPreprocessor = true;
      }

      if (inPreprocessor || inLineComment) {
        buffer += char;
        continue;
      }

      if (inBlockComment) {
        buffer += char;
        if (char === "*" && next === "/") {
          buffer += next;
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        buffer += char;
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === "/" && next === "/") {
        buffer += "//";
        inLineComment = true;
        index += 1;
        continue;
      }

      if (char === "/" && next === "*") {
        buffer += "/*";
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        buffer += char;
        continue;
      }

      if (char === "(") parenthesisDepth += 1;
      if (char === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      if (char === "[") bracketDepth += 1;
      if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

      if (char === "{") {
        buffer += char;
        flush();
        continue;
      }

      if (char === "}") {
        flush();
        result.push("}");
        lineHasContent = true;
        continue;
      }

      if (char === ";" && parenthesisDepth === 0 && bracketDepth === 0) {
        if (!buffer.trim() && result.length > 0 && /^}/.test(result[result.length - 1])) {
          result[result.length - 1] += ";";
        } else {
          buffer += char;
          flush();
        }
        continue;
      }

      buffer += char;
    }

    flush();
    return result;
  }

  function formatPythonCode(code, unit) {
    const result = [];
    const indentStack = [0];
    let previousWasBlank = false;

    for (const rawLine of code.split("\n")) {
      const trimmed = rawLine.replace(/\t/g, unit).trim();

      if (!trimmed) {
        if (!previousWasBlank && result.length > 0) {
          result.push("");
          previousWasBlank = true;
        }
        continue;
      }

      const sourceIndent = measureIndent(rawLine);
      while (indentStack.length > 1 && sourceIndent < indentStack[indentStack.length - 1]) {
        indentStack.pop();
      }

      if (sourceIndent > indentStack[indentStack.length - 1]) {
        indentStack.push(sourceIndent);
      }

      result.push(unit.repeat(indentStack.length - 1) + trimmed);
      previousWasBlank = false;
    }

    return finalizeCode(result.join("\n"));
  }

  function measureIndent(line) {
    const leading = (String(line || "").match(/^[ \t]*/) || [""])[0];
    return Array.from(leading).reduce((width, char) => width + (char === "\t" ? 4 : 1), 0);
  }

  function stripFormattingNoise(line, state) {
    let result = "";
    let quote = "";
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (state.inBlockComment) {
        if (char === "*" && next === "/") {
          state.inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }

      if (char === "/" && next === "*") {
        state.inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "/" && next === "/") break;
      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      result += char;
    }

    return result;
  }

  function countCharacter(value, needle) {
    return Array.from(String(value || "")).reduce((count, char) => count + (char === needle ? 1 : 0), 0);
  }

  function finalizeCode(value) {
    return String(value || "")
      .replace(/^(?:[ \t]*\n)+/, "")
      .replace(/(?:\n[ \t]*)+$/, "")
      .replace(/\n{3,}/g, "\n\n");
  }

  window.CodingAssistantCore = {
    applyTextChange,
    buildTextDiff,
    buildMessages,
    compactText,
    detectLanguage,
    extractSuggestedCode,
    formatCode,
    langName,
    mapFormattedOffset,
    normalizeProblemPayload,
    prependStatusMessage,
    stripCodeComments
  };
})();
