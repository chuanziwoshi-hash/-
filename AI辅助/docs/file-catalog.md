# 项目文件分类清单

本项目是一个 Manifest V3 浏览器扩展。当前运行路径由 `manifest.json` 明确引用，代码文件已按扩展运行边界自然分组，因此本次没有移动现有运行文件，避免破坏扩展加载路径。

## 入口与配置

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `manifest.json` | 扩展入口配置 | 声明扩展名称、权限、弹窗入口、后台 service worker、content scripts 和注入样式。 |

## 后台能力

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `background/ai-request-registry.js` | 后台 AI 请求注册表 | 管理正在运行的 AI 请求，支持按请求 ID 取消和清理。 |
| `background/background.js` | 后台 service worker | 处理扩展消息、AI 接口调用、配置读取、题面抓取、LeetCode 编辑器注入/粘贴/快照恢复等后台能力。 |

## 页面注入助手

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `content/assistant-core.js` | AI 提示词与通用逻辑 | 负责语言识别、构造 AI 消息、提取建议代码、规范化题面返回值。 |
| `content/draft-history.js` | 草稿历史工具 | 提供最近草稿历史的规范化、去重、显示标签和保存判断等纯逻辑。 |
| `content/content-script.js` | 页面浮窗主逻辑 | 创建并管理页面内 AI 代码助手浮窗、代码编辑框、行号/当前行高亮、左上角拉伸、选中代码解释、题面同步、插入/撤销等交互。 |
| `content/content-style.css` | Content script 宿主样式 | 给扩展注入根节点提供基础固定定位。主要 UI 样式目前内联在 `content-script.js` 的 shadow DOM 中。 |

## 弹窗设置页

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `frontend/popup/popup.html` | 弹窗结构 | 扩展图标弹窗页面，提供 API、模型、题目来源和服务器配置表单。 |
| `frontend/popup/popup.css` | 弹窗样式 | 设置弹窗页面的布局、表单、按钮和帮助文本样式。 |
| `frontend/popup/popup.js` | 弹窗逻辑 | 读取/保存扩展配置，测试 AI 接口和题目来源，打开页面内助手或独立编辑窗口。 |

## 独立编辑窗口
| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `frontend/editor/editor.html` | 独立编辑器结构 | 提供浏览器窗口外的题目、代码和 AI 输出工作区。 |
| `frontend/editor/editor.css` | 独立编辑器样式 | 设置独立编辑窗口的三栏布局、工具栏、代码区和响应式样式。 |
| `frontend/editor/editor.js` | 独立编辑器逻辑 | 同步源标签页题目上下文，复用 AI 提示词，读写页面内面板同一份草稿，并将代码插回源页面。 |

## 展示页

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `frontend/landing/index.html` | 项目展示页结构 | 静态介绍页，用于展示扩展定位和能力。 |
| `frontend/landing/style.css` | 项目展示页样式 | 展示页视觉样式。 |

## 题目服务器示例

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `server-example/problem-server.js` | 自定义题目服务示例 | 提供最小 Node.js HTTP 服务，演示扩展如何向本地服务请求题目上下文。 |
| `server-example/README.md` | 示例说明文档 | 说明示例服务启动方式、请求格式和返回格式。 |

## 文档

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `docs/file-catalog.md` | 文件分类文档 | 当前文件的分类、用途和检查结果。 |

## 检查结果

已检查全部当前文件路径，分类如下：

- 配置文件：1 个，`manifest.json`
- JavaScript 文件：8 个，后台、AI 请求注册表、content script、草稿历史工具、弹窗逻辑、独立编辑器逻辑、示例服务
- CSS 文件：4 个，content 宿主样式、弹窗样式、独立编辑器样式、展示页样式
- HTML 文件：3 个，弹窗页、独立编辑器页和展示页
- Markdown 文件：1 个，示例服务说明

已执行 JavaScript 语法检查：

```powershell
node --check background\background.js
node --check content\assistant-core.js
node --check content\content-script.js
node --check frontend\editor\editor.js
node --check frontend\popup\popup.js
node --check server-example\problem-server.js
```

结果：全部通过。

## 维护建议

当前目录划分合理，不建议为了分类强行移动运行文件。后续如果继续拆分，优先考虑这两个大文件：

- `content/content-script.js`：可拆为 UI 组件、题面解析、编辑器能力、插入/撤销能力。
- `background/background.js`：可拆为 AI 请求、题目源抓取、LeetCode 编辑器桥接、通用 fetch 工具。

如果后续拆分真实代码文件，需要同步更新 `manifest.json` 和脚本加载顺序。
