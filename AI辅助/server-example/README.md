# 题目服务器示例

这个目录提供一个可直接运行的 Node.js 题目上下文服务器，支持健康检查、Bearer Token、内存缓存、请求校验和来源元数据。

如果只使用洛谷或力扣，无需启动这个服务。插件已经能够直接读取这两个平台；自定义服务器更适合校内 OJ、其他题库、代理抓取或统一缓存。

## 启动

无鉴权的本地开发模式：

```bash
node server-example/problem-server.js
```

设置 Token：

```powershell
$env:PROBLEM_SERVER_TOKEN="replace-with-a-long-random-token"
node server-example/problem-server.js
```

默认只监听 `127.0.0.1:8787`。在插件中填写：

```text
http://127.0.0.1:8787/problem-context
```

如果设置了 `PROBLEM_SERVER_TOKEN`，插件里的“服务器 Token”必须填写相同内容。

## 健康检查

```text
GET http://127.0.0.1:8787/health
```

返回服务器版本和能力：

```json
{
  "ok": true,
  "name": "CodeMate problem server",
  "version": "2.0.0",
  "capabilities": {
    "problemContext": true,
    "cache": true,
    "authentication": true
  }
}
```

配置 Token 后，健康检查和题目请求都需要：

```text
Authorization: Bearer replace-with-a-long-random-token
```

## 请求格式

扩展使用 `POST /problem-context` 发送 JSON：

```json
{
  "pageUrl": "当前网页地址",
  "pageTitle": "当前网页标题",
  "pageText": "扩展读取到的题面正文",
  "selection": "用户选中的网页文本",
  "code": "用户当前编写的代码",
  "language": "用户选择的语言",
  "platform": "例如 luogu 或 leetcode",
  "problemId": "例如 P1001 或 two-sum",
  "test": false
}
```

插件弹窗可以分别控制是否发送 `pageText`、`selection` 和 `code`。默认发送题面正文，不发送选中文本和当前代码。

## 返回格式

```json
{
  "problem": "整理后的完整题面",
  "source": "server-example:luogu",
  "meta": {
    "version": "2.0.0",
    "requestId": "请求标识",
    "platform": "luogu",
    "problemId": "P1001",
    "cached": false
  }
}
```

为兼容其他服务器，插件仍接受纯文本，以及 JSON 字段 `problem`、`question`、`description`、`content` 或 `context`。

## 缓存

存在 `platform` 和 `problemId` 时，服务器会按二者组合缓存题面。默认缓存 10 分钟、最多 200 道题。

可用环境变量：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PROBLEM_SERVER_TOKEN` | 空 | Bearer Token；为空时不鉴权 |
| `PROBLEM_SERVER_CORS_ORIGIN` | `*` | 允许的跨域来源 |
| `PROBLEM_SERVER_BODY_LIMIT` | `256000` | 最大请求体字节数 |
| `PROBLEM_SERVER_CACHE_TTL_MS` | `600000` | 缓存有效时间 |
| `PROBLEM_SERVER_CACHE_MAX_ENTRIES` | `200` | 最大缓存题目数 |

## 测试

在项目根目录运行：

```powershell
node --test tests/problem-server.test.js
```
