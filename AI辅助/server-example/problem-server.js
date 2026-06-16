const http = require("http");

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/problem-context") {
    sendJson(response, 404, { error: "Use POST /problem-context" });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(request));
    const problem = buildProblemContext(payload);

    sendJson(response, 200, {
      problem,
      source: "server-example"
    });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || String(error)
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Problem context server: http://127.0.0.1:${PORT}/problem-context`);
});

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body || "{}"));
    request.on("error", reject);
  });
}

function buildProblemContext(payload) {
  if (payload.test) {
    return "连接测试题目：读取两个整数 a 和 b，输出它们的和。";
  }

  const pieces = [
    payload.platform ? `平台：${payload.platform}` : "",
    payload.problemId ? `题号：${payload.problemId}` : "",
    payload.pageTitle ? `页面标题：${payload.pageTitle}` : "",
    payload.pageUrl ? `页面地址：${payload.pageUrl}` : "",
    payload.selection ? `选中内容：\n${payload.selection}` : "",
    payload.pageText ? `页面正文：\n${payload.pageText}` : ""
  ];

  return pieces.filter(Boolean).join("\n\n").slice(0, 12000);
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}
