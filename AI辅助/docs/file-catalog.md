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
| `background/ai-client.js` | 模型请求与重试 | 适配输出参数、输出预算、响应完成状态、有限重试，以及覆盖响应读取的超时和取消。 |
| `background/background.js` | 后台 service worker | 处理扩展消息、AI 接口调用、配置读取、题面抓取、LeetCode 编辑器注入/粘贴/快照恢复等后台能力。 |

## 页面注入助手

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `content/assistant-core.js` | AI 提示词与通用逻辑 | 负责语言识别、构造 AI 消息、提取建议代码、规范化题面返回值。 |
| `content/ai-budget.js` | 共享预算工具 | 校验配置、估算输入长度、根据显式任务类型分配输出预算。 |
| `content/code-review.js` | 分段代码检查 | 规划完整代码分段、全局复核、关联代码补查、检查进度、去重和失败恢复。 |
| `content/draft-history.js` | 草稿历史工具 | 提供最近草稿历史的规范化、去重、显示标签和保存判断等纯逻辑。 |
| `content/content-script.js` | 页面浮窗主逻辑 | 创建并管理页面内 AI 代码助手浮窗、代码编辑框、行号/当前行高亮、左上角拉伸、选中代码解释、题面同步、插入/撤销等交互。 |
| `content/content-style.css` | Content script 宿主样式 | 给扩展注入根节点提供基础固定定位。主要 UI 样式目前内联在 `content-script.js` 的 shadow DOM 中。 |

## 弹窗设置页

| 文件 | 分类 | 作用 |
| --- | --- | --- |
| `frontend/popup/popup.html` | 弹窗结构 | 扩展图标弹窗页面，提供 API、模型、题目来源和服务器配置表单。 |
| `frontend/popup/popup.css` | 弹窗样式 | 设置弹窗页面的布局、表单、按钮和帮助文本样式。 |
| `frontend/popup/popup.js` | 弹窗逻辑 | 读取/保存扩展配置，测试 AI 接口和题目来源。 |

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

运行文件按后台、页面脚本、配置弹窗、展示页和题目服务器示例分组；自动化回归位于 `tests/`。新增模块已同步配置到后台导入和页面脚本加载顺序中。

已执行 JavaScript 语法检查：

```powershell
node --check background\background.js
node --check background\ai-client.js
node --check content\assistant-core.js
node --check content\ai-budget.js
node --check content\code-review.js
node --check content\content-script.js
node --check frontend\popup\popup.js
node --check server-example\problem-server.js
node --test tests/*.test.js
```

结果：全部通过。

## 维护建议

当前目录划分合理，不建议为了分类强行移动运行文件。后续如果继续拆分，优先考虑这两个大文件：

- `content/content-script.js`：可拆为 UI 组件、题面解析、编辑器能力、插入/撤销能力。
- `background/background.js`：可拆为 AI 请求、题目源抓取、LeetCode 编辑器桥接、通用 fetch 工具。

如果后续拆分真实代码文件，需要同步更新 `manifest.json` 和脚本加载顺序。
