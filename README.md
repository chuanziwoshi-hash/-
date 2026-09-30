[README.md](https://github.com/user-attachments/files/32842019/README.md)
# 码伴 CodeMate

码伴 CodeMate 是一个 Manifest V3 浏览器扩展，用于刷算法题时在网页里打开一个悬浮代码助手。它可以同步题目上下文、给出下一步代码建议、检查已有代码、解释选中代码，并把代码插入到页面编辑器。

## 快速开始

1. 打开 Chrome 或 Edge 的扩展管理页。
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录，也就是包含 `manifest.json` 的文件夹。
5. 点击浏览器右上角扩展图标，配置 AI API 地址、模型和 API Key。
6. 打开洛谷、力扣或其他题目页面，点击页面右下角 `码` 悬浮按钮开始使用。

修改代码后，需要在扩展管理页重新加载扩展，并刷新正在使用的网页。

## 主要功能

- 悬浮代码编辑器
- 独立编辑窗口，与页面内面板共享草稿
- 题目上下文同步
- 下一段代码建议
- 已有代码检查
- 选中代码解释
- AI 请求停止生成
- 建议代码插入前预览
- 最近 5 次草稿历史恢复
- 插入建议和撤销插入
- 插入到页面编辑器，包含力扣编辑器适配
- 行号、当前行高亮、AI 回答行号点击定位
- Tab 缩进、自动缩进、括号配对、基础格式化
- 按页面自动保存草稿

## 常用快捷键

全局快捷键：

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + M` | 直接打开独立编辑窗口（Windows/Linux 默认） |

面板内快捷键只在助手面板打开，并且焦点位于助手内部时生效。

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + B` | 显示或隐藏助手 |
| `Ctrl/Cmd + Enter` | 下一段该写什么 |
| `Ctrl/Cmd + Shift + Enter` | 检查已有代码 |
| `Ctrl/Cmd + E` | 解释选中代码 |
| `Shift + Alt + F` | 格式化代码 |

浏览器快捷键可以在 `chrome://extensions/shortcuts` 或 `edge://extensions/shortcuts` 里修改。

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `manifest.json` | 扩展入口和权限配置 |
| `background/` | 后台 service worker、AI 请求注册表、题目抓取、力扣编辑器桥接 |
| `content/` | 页面注入脚本、草稿历史工具、悬浮助手 UI、编辑器交互、提示词构造 |
| `frontend/popup/` | 扩展弹窗配置页 |
| `frontend/editor/` | 独立代码编辑窗口 |
| `frontend/landing/` | 静态展示页 |
| `server-example/` | 自定义题目服务器示例 |
| `docs/` | 使用说明和文件分类文档 |

## 更多文档

- 详细使用说明：[docs/usage-guide.md](docs/usage-guide.md)
- 文件分类清单：[docs/file-catalog.md](docs/file-catalog.md)
- 自定义题目服务示例：[server-example/README.md](server-example/README.md)

## 开发检查

修改 JavaScript 后，可在项目根目录运行：

```powershell
node --check background\background.js
node --check content\assistant-core.js
node --check content\content-script.js
node --check frontend\editor\editor.js
node --check frontend\popup\popup.js
node --check server-example\problem-server.js
```

这些命令只做语法检查，不会启动扩展。
