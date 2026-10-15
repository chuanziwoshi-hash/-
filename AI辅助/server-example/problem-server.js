const crypto = require("crypto");
const http = require("http");

const SERVER_VERSION = "2.0.0";
const DEFAULT_BODY_LIMIT = 256_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 200;

function createProblemServer(options = {}) {
  const config = createServerConfig(options);
  const cache = new Map();

  return http.createServer(async (request, response) => {
    setCorsHeaders(response, config.corsOrigin);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const pathname = getRequestPathname(request.url);

    if (pathname === "/health" && request.method === "GET") {
      if (!authorizeRequest(request, response, config.token)) return;
      sendJson(response, 200, buildHealthPayload(config));
      return;
    }

    if (pathname !== "/problem-context" || request.method !== "POST") {
      sendJson(response, 404, { error: "Use GET /health or POST /problem-context" });
      return;
    }

    if (!authorizeRequest(request, response, config.token)) return;

    if (!isJsonRequest(request)) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }

    try {
      const payload = JSON.parse(await readBody(request, config.bodyLimit));
      validatePayload(payload);

      const requestId = crypto.randomUUID();
      const cacheKey = getProblemCacheKey(payload);
      const cached = cacheKey ? getCachedProblem(cache, cacheKey, config.cacheTtlMs) : null;

      if (cached) {
        sendJson(response, 200, buildProblemResponse(cached.problem, payload, requestId, true));
        return;
      }

      const problem = buildProblemContext(payload);

      if (cacheKey && !payload.test) {
        setCachedProblem(cache, cacheKey, problem, config.cacheMaxEntries);
      }

      sendJson(response, 200, buildProblemResponse(problem, payload, requestId, false));
    } catch (error) {
      sendJson(response, Number(error.statusCode) || 400, {
        error: error.message || String(error)
      });
    }
  });
}

function createServerConfig(options) {
  return {
    token: getOption(options, "token", process.env.PROBLEM_SERVER_TOKEN || ""),
    corsOrigin: getOption(options, "corsOrigin", process.env.PROBLEM_SERVER_CORS_ORIGIN || "*"),
    bodyLimit: normalizePositiveNumber(
      getOption(options, "bodyLimit", process.env.PROBLEM_SERVER_BODY_LIMIT),
      DEFAULT_BODY_LIMIT
    ),
    cacheTtlMs: normalizePositiveNumber(
      getOption(options, "cacheTtlMs", process.env.PROBLEM_SERVER_CACHE_TTL_MS),
      DEFAULT_CACHE_TTL_MS
    ),
    cacheMaxEntries: normalizePositiveNumber(
      getOption(options, "cacheMaxEntries", process.env.PROBLEM_SERVER_CACHE_MAX_ENTRIES),
      DEFAULT_CACHE_MAX_ENTRIES
    )
  };
}

function getOption(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key) ? options[key] : fallback;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function getRequestPathname(value) {
  try {
    return new URL(String(value || "/"), "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

function authorizeRequest(request, response, token) {
  const expectedToken = String(token || "");

  if (!expectedToken) return true;

  const provided = String(request.headers.authorization || "");
  const expected = "Bearer " + expectedToken;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  const authorized = providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!authorized) {
    response.setHeader("WWW-Authenticate", "Bearer");
    sendJson(response, 401, { error: "Invalid or missing problem server token" });
  }

  return authorized;
}

function isJsonRequest(request) {
  return String(request.headers["content-type"] || "")
    .toLowerCase()
    .includes("application/json");
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let body = "";
    let rejected = false;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) return;
      body += chunk;

      if (Buffer.byteLength(body, "utf8") > limit) {
        rejected = true;
        const error = new Error("Request body too large");
        error.statusCode = 413;
        reject(error);
      }
    });
    request.on("end", () => {
      if (!rejected) resolve(body || "{}");
    });
    request.on("error", reject);
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("Request body must be a JSON object");
    error.statusCode = 400;
    throw error;
  }

  if (payload.test) return;

  const hasContext = [
    payload.problemId,
    payload.pageUrl,
    payload.pageTitle,
    payload.pageText,
    payload.selection
  ].some((value) => String(value || "").trim());

  if (!hasContext) {
    const error = new Error("Request does not contain problem context");
    error.statusCode = 422;
    throw error;
  }
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

  return pieces.filter(Boolean).join("\n\n").slice(0, 30_000);
}

function getProblemCacheKey(payload) {
  const platform = String(payload.platform || "").trim().toLowerCase();
  const problemId = String(payload.problemId || "").trim().toLowerCase();
  return platform && problemId && !payload.test ? platform + ":" + problemId : "";
}

function getCachedProblem(cache, key, ttlMs) {
  const entry = cache.get(key);

  if (!entry) return null;
  if (Date.now() - entry.savedAt <= ttlMs) return entry;

  cache.delete(key);
  return null;
}

function setCachedProblem(cache, key, problem, maxEntries) {
  cache.delete(key);
  cache.set(key, { problem, savedAt: Date.now() });

  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}

function buildProblemResponse(problem, payload, requestId, cached) {
  const platform = String(payload.platform || "").trim();
  const problemId = String(payload.problemId || "").trim();

  return {
    problem,
    source: platform ? "server-example:" + platform : "server-example",
    meta: {
      version: SERVER_VERSION,
      requestId,
      platform,
      problemId,
      cached
    }
  };
}

function buildHealthPayload(config) {
  return {
    ok: true,
    name: "CodeMate problem server",
    version: SERVER_VERSION,
    capabilities: {
      problemContext: true,
      cache: true,
      authentication: Boolean(config.token)
    }
  };
}

function setCorsHeaders(response, origin) {
  response.setHeader("Access-Control-Allow-Origin", String(origin || "*"));
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Vary", "Origin");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1";
  const server = createProblemServer();

  server.listen(port, host, () => {
    console.log(`Problem context server: http://${host}:${port}/problem-context`);
    console.log(`Health check: http://${host}:${port}/health`);
  });
}

module.exports = {
  SERVER_VERSION,
  buildProblemContext,
  createProblemServer
};
