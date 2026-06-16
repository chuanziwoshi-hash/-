# 题目服务器示例

这个目录提供一个最小 Node.js 服务器，用来演示扩展如何从自定义服务器读取题目上下文。

如果你只想连接洛谷或力扣，不需要启动这个示例服务。扩展弹窗里的“题目来源”选择“自动”“只连接洛谷题目页”或“只连接力扣题目页”，然后打开 `https://www.luogu.com.cn/problem/P1001` 或 `https://leetcode.cn/problems/two-sum/description/` 这类题目页即可。

## 启动

```bash
node server-example/problem-server.js
```

启动后，在扩展弹窗里填写：

```text
http://127.0.0.1:8787/problem-context
```

## 请求格式

扩展会用 `POST` 发送 JSON：

```json
{
  "pageUrl": "当前网页地址",
  "pageTitle": "当前网页标题",
  "pageText": "扩展从网页读取到的正文",
  "selection": "用户选中的文本",
  "code": "用户当前写到的代码",
  "language": "用户选择的语言",
  "platform": "例如 luogu 或 leetcode",
  "problemId": "例如 P1001 或 two-sum",
  "test": false
}
```

## 返回格式

服务器可以返回 JSON：

```json
{
  "problem": "题目完整文本"
}
```

也可以返回字段 `question`、`description`、`content`、`context`，扩展都会识别。
