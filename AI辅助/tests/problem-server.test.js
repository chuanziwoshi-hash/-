const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  SERVER_VERSION,
  createProblemServer
} = require("../server-example/problem-server.js");

test("problem server health check enforces the configured bearer token", async () => {
  await withServer({ token: "secret-token" }, async (origin) => {
    const unauthorized = await request(origin, "/health");
    assert.equal(unauthorized.status, 401);

    const authorized = await request(origin, "/health", {
      headers: { Authorization: "Bearer secret-token" }
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.json.ok, true);
    assert.equal(authorized.json.version, SERVER_VERSION);
    assert.equal(authorized.json.capabilities.authentication, true);
  });
});

test("problem server caches normalized context by platform and problem id", async () => {
  await withServer({ token: "" }, async (origin) => {
    const payload = {
      platform: "luogu",
      problemId: "P1001",
      pageTitle: "A+B Problem",
      pageUrl: "https://www.luogu.com.cn/problem/P1001",
      pageText: "输入两个整数，输出它们的和。"
    };
    const first = await request(origin, "/problem-context", { method: "POST", json: payload });
    const second = await request(origin, "/problem-context", { method: "POST", json: payload });

    assert.equal(first.status, 200);
    assert.equal(first.json.meta.cached, false);
    assert.equal(second.status, 200);
    assert.equal(second.json.meta.cached, true);
    assert.equal(second.json.problem, first.json.problem);
    assert.equal(second.json.source, "server-example:luogu");
  });
});

test("problem server rejects unsupported content types and oversized payloads", async () => {
  await withServer({ token: "", bodyLimit: 32 }, async (origin) => {
    const unsupported = await request(origin, "/problem-context", {
      method: "POST",
      body: "plain text",
      headers: { "Content-Type": "text/plain" }
    });
    assert.equal(unsupported.status, 415);

    const oversized = await request(origin, "/problem-context", {
      method: "POST",
      json: { pageText: "x".repeat(100) }
    });
    assert.equal(oversized.status, 413);
  });
});

async function withServer(options, callback) {
  const server = createProblemServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const origin = "http://127.0.0.1:" + address.port;

  try {
    await callback(origin);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function request(origin, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    const body = Object.prototype.hasOwnProperty.call(options, "json")
      ? JSON.stringify(options.json)
      : String(options.body || "");

    if (Object.prototype.hasOwnProperty.call(options, "json")) {
      headers["Content-Type"] = "application/json";
    }
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const request = http.request(origin + pathname, {
      method: options.method || "GET",
      headers
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(responseBody);
        } catch {
          json = null;
        }
        resolve({ status: response.statusCode, body: responseBody, json });
      });
    });

    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}
