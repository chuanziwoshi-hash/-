# AI 模型与接口兼容性说明

本文说明码伴 CodeMate 当前能够连接哪些模型、不同模型的兼容程度，以及要完整支持新一代推理模型需要修改哪些地方。

> 文档状态日期：2026-10-14。模型状态、账号权限和弃用日期可能变化，最终以服务商控制台和官方模型列表为准。

> 2026-10-15 实现更新：已增加输出预算、上下文容量、参数自动适配、显式推理设置和长代码分段检查。以下模型清单保留原记录；本次更新的参数行为见第 1、6 节。

## 1. 当前接口实现

扩展目前固定使用 OpenAI Chat Completions 协议：

```text
POST /v1/chat/completions
Authorization: Bearer <API Key>
Content-Type: application/json
```

实际请求体的主要字段为：

```json
{
  "model": "用户配置的模型名",
  "messages": [],
  "max_completion_tokens": 4096,
  "stream": false
}
```

响应解析优先读取 `choices[0].message.content`，同时兼容部分服务返回的 `choices[0].text`、`output_text`、`output`、`content` 或 `text` 字段。

上例为自动模式下直连 OpenAI 的预算字段。兼容服务默认使用 `max_tokens`；收到明确的“不支持该字段”错误时，自动模式允许切换一次，并在后台运行期间记住成功配置。也可在设置中固定字段。两个上限字段不会同时发送。

请求通过显式任务类型分配预算，不再扫描代码中的关键词猜测任务。普通检查初始预算通常为 4096 token，复杂检查可提高至 8192 token；实际不超过用户配置上限及估算剩余上下文。长代码会完整分段检查，再做全局复核。`finish_reason: length` 即使包含部分正文也视为未完成。[OpenAI 官方 Chat Completions 参数文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)说明了输出预算及推理 token 的计入方式。

因此，判断一个模型是否可用需要同时满足：

1. 服务商提供 OpenAI 兼容的 `/v1/chat/completions` 地址。
2. 模型接受 `messages` 格式的输入。
3. 模型接受当前请求参数，或者服务商会忽略不支持的参数。
4. 返回内容能够被当前响应解析逻辑识别。

## 2. 兼容等级

| 等级 | 含义 |
| --- | --- |
| 基本兼容 | 支持 Chat Completions，现有实现通常可以调用，但仍应通过“测试 AI 连接”验证账号权限和参数限制。 |
| 条件兼容 | 支持 Chat Completions，但需要核实账号权限、输出上限和推理设置，并通过连接测试验证。 |
| 改造后兼容 | 只支持 Responses API 或其他原生协议，当前代码不能直接调用。 |
| 不建议使用 | 已弃用、已停止服务，或者存在明确的替代型号。 |

“官方支持 Chat Completions”不等于“当前代码一定可以直接使用”。模型端点、请求参数和响应格式必须同时兼容。

## 3. OpenAI 当前型号

### 3.1 GPT-6 系列

| 模型 ID | 定位 | 当前扩展兼容性 | 说明 |
| --- | --- | --- | --- |
| `gpt-6-astra` | 最高能力，适合复杂推理和代码任务 | 条件兼容 | 请求已省略固定 `temperature`；仍需验证接口权限及预算配置。 |
| `gpt-6.1-sol` | 质量与成本平衡 | 条件兼容 | Chat Completions 可用于无工具请求；建议移除不兼容参数并显式设置推理强度。 |
| `gpt-6-sol` | 通用推理模型 | 条件兼容 | 使用 Chat Completions 时应根据推理强度动态决定是否发送 `temperature`。 |
| `gpt-6-luna` | 低成本、高吞吐 | 条件兼容 | 适合频繁的短代码建议；已适配预算参数，需测试账号可用性。 |

GPT-6 系列的官方首选接口是 Responses API。当前扩展只发送文本消息，不使用工具调用，因此可以保留 Chat Completions 作为过渡方案。

### 3.2 GPT-5.6 系列

| 模型 ID | 定位 | 当前扩展兼容性 | 推荐用途 |
| --- | --- | --- | --- |
| `gpt-5.6-sol` | 旗舰能力 | 条件兼容 | 复杂代码生成、代码审查和高难度算法分析 |
| `gpt-5.6-terra` | 质量与成本平衡 | 条件兼容 | 日常代码补全，建议作为默认选择 |
| `gpt-5.6-luna` | 低成本、高吞吐 | 条件兼容 | 高频短建议、简单解释和基础检查 |
| `gpt-5.6` | 指向 Sol 的别名 | 条件兼容 | 可以使用，但固定模型 ID 更利于控制行为和回归测试 |

本节模型列表沿用原记录，未在本次实现更新中重新核实。当前扩展已对 `gpt-5` 及更新系列省略 `temperature`，直连 OpenAI 时自动使用 `max_completion_tokens`；模型权限和推理强度仍需通过实际接口验证。

### 3.3 其他 GPT-5 系列

| 模型 ID | 官方接口 | 当前扩展兼容性 | 状态与建议 |
| --- | --- | --- | --- |
| `gpt-5.5` | Chat Completions、Responses | 条件兼容 | 默认推理强度为 `medium`，建议移除固定 `temperature`。 |
| `gpt-5.4` | Chat Completions、Responses | 基本兼容 | 默认推理强度为 `none`，但仍建议改用 `max_completion_tokens`。 |
| `gpt-5.4-mini` | Chat Completions、Responses | 基本兼容 | 适合较低成本的日常代码任务。 |
| `gpt-5.4-nano` | Chat Completions、Responses | 不建议使用 | 已弃用，计划于 2027-04-01 停止服务；迁移到 `gpt-6-luna`。 |
| `gpt-5.2` | Chat Completions、Responses | 基本兼容 | 较早型号，不建议作为新配置的首选。 |
| `gpt-5.1` | Chat Completions、Responses | 不建议使用 | 已弃用，计划于 2027-04-01 停止服务；迁移到 `gpt-6-sol`。 |
| `gpt-5` | Chat Completions、Responses | 不建议使用 | 已弃用，官方公告的停止日期为 2026-12-11。 |
| `gpt-5-mini` | Chat Completions、Responses | 不建议使用 | 已弃用，官方公告的停止日期为 2026-12-11。 |
| `gpt-5-nano` | Chat Completions、Responses | 不建议使用 | 已弃用，官方公告的停止日期为 2026-12-11。 |

以下型号不能通过当前 Chat Completions 请求直接使用：

| 模型 ID | 当前扩展兼容性 | 原因 |
| --- | --- | --- |
| `gpt-5.5-pro` | 改造后兼容 | 面向 Responses API 请求，需要新增 Responses 请求和响应处理。 |
| `gpt-5.4-pro` | 改造后兼容 | 官方说明为 Responses API only。 |
| `gpt-5.2-pro` | 改造后兼容 | 官方说明为 Responses API only。 |
| `gpt-5-pro` | 不建议使用 | Responses API only，且已经弃用。 |

`gpt-5.2-chat-latest`、`gpt-5.3-chat-latest` 已于 2026-08-10 停止 API 服务；`gpt-5.1-codex`、`gpt-5.1-chat-latest` 等型号也已停止服务，不应继续配置。

### 3.4 当前默认模型

项目当前默认模型是 `gpt-4o-mini`。该模型仍可能在停止日期前调用，但 OpenAI 已于 2026-10-14 宣布弃用相关快照，并计划于 2027-01-14 停止服务，官方推荐迁移到 `gpt-6-luna`。

参数适配已经完成，但本次没有更改默认模型，也没有重新核实本节模型生命周期记录。请按服务商当前模型列表配置，并通过“测试 AI 连接”验证。

### 3.5 ChatGPT 快照模型

| 模型 ID | 当前扩展兼容性 | 说明 |
| --- | --- | --- |
| `chat-latest` | 条件兼容 | 支持文本生成，但会随 ChatGPT 的 Instant 模型更新，行为可能变化。官方建议生产 API 使用固定的 GPT 型号。 |
| `gpt-5.3-chat-latest` | 不可用 | 已于 2026-08-10 停止 API 服务。 |
| `gpt-5.2-chat-latest` | 不可用 | 已于 2026-08-10 停止 API 服务。 |
| `gpt-5.1-chat-latest`、`gpt-5-chat-latest` | 不可用 | 已停止服务。 |
| `chatgpt-4o-latest` | 不可用 | 已于 2026-02-17 停止服务。 |

`chat-latest` 适合测试 ChatGPT 当前行为，不适合作为码伴的长期默认模型；模型快照变化可能导致代码建议格式、延迟和参数支持发生变化。

### 3.6 GPT-4 与更早的文本模型

| 模型 ID | 当前扩展兼容性 | 状态与建议 |
| --- | --- | --- |
| `gpt-4o`、`gpt-4o-mini` | 不建议使用 | Chat Completions 协议兼容，但已经弃用；相关快照计划于 2027-01-14 停止服务。 |
| `gpt-4.1`、`gpt-4.1-mini` | 不建议使用 | 协议兼容，但已经弃用；相关快照计划于 2027-01-14 停止服务。 |
| `gpt-4.1-nano` | 不建议使用 | 已弃用，应迁移到当前低成本型号。 |
| `gpt-4-turbo`、`gpt-4` | 不建议使用 | 旧版模型，已进入弃用或停止周期。 |
| `gpt-3.5-turbo` | 不建议使用 | 旧版聊天模型，已进入弃用周期。 |
| `davinci-002`、`babbage-002` | 不兼容 | 使用旧式 Completions 协议，不是当前扩展需要的聊天协议。 |

这些模型中的一部分在停止日期前仍可能返回结果，但不应因此被视为新的可选配置。

### 3.7 o 系列、Codex 与旧工具模型

| 模型组 | 代表模型 ID | 当前扩展兼容性 | 原因 |
| --- | --- | --- | --- |
| o 系列 | `o3`、`o3-pro`、`o4-mini`、`o3-mini`、`o1`、`o1-pro`、`o1-mini`、`o1-preview` | 不建议使用 | 模型生命周期请核实服务商最新目录；请求已省略固定采样参数，但并非所有型号都支持当前聊天协议。 |
| Codex API 模型 | `gpt-5.3-codex`、`gpt-5.2-codex`、`gpt-5.1-codex`、`gpt-5.1-codex-max`、`gpt-5.1-codex-mini`、`gpt-5-codex`、`codex-mini-latest` | 不建议使用 | 目录中已标记为弃用，部分已经停止服务；码伴应使用通用 GPT 代码模型。 |
| Deep Research | `o3-deep-research`、`o4-mini-deep-research` | 不兼容 | 已弃用，并且依赖 Responses API 与工具工作流。 |
| 搜索预览 | `gpt-4o-search-preview`、`gpt-4o-mini-search-preview` | 不兼容 | 已弃用；当前扩展没有搜索请求与引用结果处理。 |
| 计算机操作预览 | `computer-use-preview` | 不兼容 | 已弃用；需要 Responses API、截图和工具调用循环。 |

## 4. OpenAI 专用模型

专用模型出现在 OpenAI 模型目录中，但不能因为它们有模型 ID 就直接填入码伴的“模型”输入框。它们的端点、请求结构或输出类型与文本聊天不同。

### 4.1 图像生成与编辑

| 模型 ID | 用途 | 当前扩展兼容性 |
| --- | --- | --- |
| `gpt-image-2.5-sunburst` | 高质量图像生成与编辑 | 不兼容，需要 Images API 或 Responses 图像工具 |
| `gpt-image-2.5-flare` | 快速图像生成与编辑 | 不兼容，需要 Images API 或 Responses 图像工具 |
| `gpt-image-2` | 图像生成与编辑 | 不兼容，需要 Images API 或 Responses 图像工具 |
| `gpt-image-1.5`、`gpt-image-1`、`gpt-image-1-mini`、`chatgpt-image-latest` | 旧版图像模型 | 已弃用，不应新增接入 |

当前扩展没有图像参数、Base64/URL 输出处理或图片展示，因此不能使用这些模型。普通 GPT 模型虽然支持图像输入，但码伴现在只构造纯文本 `messages`，也尚未开放视觉输入能力。

### 4.2 实时语音、音频与转写

| 模型组 | 当前模型 ID | 当前扩展兼容性 | 所需改造 |
| --- | --- | --- | --- |
| Live/Realtime 对话 | `gpt-live-1`、`gpt-realtime-2.1`、`gpt-realtime-2.1-mini`、`gpt-realtime-2`、`gpt-realtime-1.5` | 不兼容 | 接入 Live/Realtime API、WebRTC 或 WebSocket，并处理音频流和事件流 |
| 实时翻译 | `gpt-realtime-translate` | 不兼容 | 接入 Realtime Translation API 和双向音频流 |
| Chat 音频 | `gpt-audio-1.5` | 改造后兼容 | 虽支持 Chat Completions，但要增加音频输入、`modalities`、音频输出解码和播放 |
| 文件转写 | `gpt-transcribe` | 不兼容 | 使用 `/v1/audio/transcriptions` 并上传音频文件 |
| 实时转写 | `gpt-live-transcribe`、`gpt-realtime-whisper` | 不兼容 | 使用实时转写会话和音频流 |
| 文字转语音 | `gpt-4o-mini-tts` | 不兼容 | 使用 `/v1/audio/speech`，选择 voice 并处理音频响应 |

`whisper-1`、`gpt-4o-transcribe`、`gpt-4o-mini-transcribe`、`gpt-4o-transcribe-diarize` 已弃用，计划于 2027-02-26 停止服务。旧版 `gpt-realtime`、`gpt-audio`、Mini/4o Audio 与 Realtime 系列也已进入弃用周期。

### 4.3 嵌入与审核

| 模型 ID | 用途 | 当前扩展兼容性 |
| --- | --- | --- |
| `text-embedding-3-large` | 高质量文本向量 | 不兼容，需要 `/v1/embeddings`，返回向量而不是代码文本 |
| `text-embedding-3-small` | 低成本文本向量 | 不兼容，需要 `/v1/embeddings` |
| `text-embedding-ada-002` | 旧版文本向量 | 不兼容，不建议新项目使用 |
| `omni-moderation-latest` | 文本和图像安全分类 | 不兼容，需要 `/v1/moderations`，返回分类结果而不是生成内容 |
| `text-moderation-latest`、`text-moderation-stable` | 旧版文本审核 | 已弃用 |

嵌入模型可用于以后实现题目检索或知识库，审核模型可用于内容安全，但它们都不是“下一段代码建议”的生成模型。

### 4.4 安全、科研与开放权重模型

| 模型 ID | 用途 | 当前扩展兼容性 |
| --- | --- | --- |
| `gpt-5.6-cyber` | 授权的网络安全研究与防御 | 改造后兼容，属于专用访问模型，不应作为普通刷题默认模型 |
| `gpt-rosalind-research` | 生命科学研究 | 改造后兼容，仅面向获批组织和科研工作流 |
| `gpt-oss-120b` | 大型开放权重模型 | 条件兼容，需要自行部署或使用提供 OpenAI 兼容接口的服务 |
| `gpt-oss-20b` | 较小的开放权重模型 | 条件兼容，需要自行部署或兼容服务 |

对于 `gpt-oss-*`，兼容性主要由 Ollama、vLLM、LM Studio 等推理服务决定，而不是由模型权重本身决定。

### 4.5 视频与微调模型

- `sora-2` 和 `sora-2-pro` 及旧 Videos API 已于 2026-09-24 停止服务，当前扩展也没有视频请求和结果处理能力。
- 以 `ft:` 开头的自定义微调模型能否使用，取决于其基础模型是否支持 Chat Completions、当前项目是否有访问权限，以及微调模型是否接受现有参数。应按“条件兼容”处理并通过连接测试验证。

## 5. OpenAI 兼容的第三方模型

扩展不依赖 OpenAI SDK，而是直接向用户填写的地址发送 HTTP 请求。因此，只要服务商提供兼容的 Chat Completions 接口，通常可以接入：

- DeepSeek、通义千问、Kimi、智谱 GLM、豆包等服务商的 OpenAI 兼容入口。
- Ollama、LM Studio、vLLM 等本地或自建服务的 OpenAI 兼容入口。
- Claude、Gemini 等模型的第三方 OpenAI 兼容网关。

第三方服务均属于“条件兼容”，需要逐项确认：

- 完整地址是否以 `/v1/chat/completions` 结尾。
- 模型 ID 是否与服务商控制台一致。
- 是否接受 Bearer Token 鉴权。
- 是否接受 `max_tokens` 或 `max_completion_tokens` 及 `stream` 字段；推理设置是否与模型能力一致。
- 最终答案是否返回在 `choices[0].message.content` 或其他已兼容字段中。

Anthropic 原生 `/v1/messages`、Google Gemini 原生 `generateContent` 以及只提供 Responses API 的服务不能直接接入，必须增加协议适配层或使用兼容网关。

## 6. 当前实现的主要兼容性问题

### 6.1 输出长度字段已支持适配

自动模式下，OpenAI 官方域名使用 `max_completion_tokens`，其他兼容服务先使用 `max_tokens`。明确的字段不支持错误可触发一次字段切换；手动指定字段时保留用户选择，不静默改写。接口限制比配置更小时，会显示接口返回的真实错误，需要按服务能力调整。

### 6.2 推理与采样参数

默认设置下，普通聊天模型使用 `temperature: 0.1`，已识别的推理模型省略该参数。未知兼容模型明确拒绝 `temperature` 时，可移除一次后重试。显式选择推理设置时不发送 `temperature`。不同模型支持的推理强度不同，配置错误会显示本次接口错误，不会擅自切换模型。

### 6.3 未实现 Responses API

当前弹窗会把地址补全为 `/v1/chat/completions`，后台也始终发送 `messages` 请求。因此 Pro 型号、完整工具调用、持久化推理和部分新功能无法使用。

修改方向：

1. 增加“接口协议”配置：`Chat Completions` 或 `Responses`。
2. Responses 请求使用 `/v1/responses` 和 `input` 字段。
3. 输出上限改用 `max_output_tokens`。
4. 继续复用现有的 `output_text` 和 `output` 响应解析能力。

### 6.4 `enable_thinking` 不是 OpenAI 标准参数

默认不发送 `enable_thinking`。用户明确选择“关闭思考（仅支持 enable_thinking 的接口）”时才发送 `enable_thinking: false`；选择“较低推理强度”或“关闭推理”时分别发送 `reasoning_effort: low` 或 `none`，需要接口支持对应取值。只返回思考过程时可在预算内增加一次输出额度，不会自动注入服务商专属开关。

所有长度截断均以未完成处理；自动重试失败后报告最后一次真实错误。认证、模型和参数错误不重复盲试；临时网络、限流及服务错误最多自动重试一次，限流等待过长时直接保留结果供之后补查。

## 7. 推荐配置

以下为原文保留的配置示例，模型可用性请以当前账号实际列表为准：

```text
AI API 地址：https://api.openai.com/v1/chat/completions
模型：gpt-5.6-terra
超时时间：90 秒或更高
```

选择原则：

- 日常使用：`gpt-5.6-terra`
- 优先节省费用：`gpt-5.6-luna`
- 优先代码质量：`gpt-5.6-sol`
- 需要 Pro 能力或完整工具能力：先将扩展改造为 Responses API

模型是否对当前 OpenAI 项目开放，最终应以 `GET /v1/models` 的返回结果或扩展中的“测试 AI 连接”为准。

## 8. 官方参考

- [OpenAI 模型目录](https://developers.openai.com/api/docs/models)
- [OpenAI 完整模型目录](https://developers.openai.com/api/docs/models/all)
- [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI 账号可用模型列表 API](https://developers.openai.com/api/reference/resources/models/methods/list)
- [GPT-5.6 使用与迁移说明](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)
- [OpenAI 模型弃用公告](https://developers.openai.com/api/docs/deprecations)
- [OpenAI 音频与语音模型](https://developers.openai.com/api/docs/models#gpt-4o-mini-tts)
- [OpenAI 审核模型说明](https://developers.openai.com/api/docs/guides/moderation)
- [GPT-5.5 Pro](https://developers.openai.com/api/docs/models/gpt-5.5-pro)
- [GPT-5.4 Pro](https://developers.openai.com/api/docs/models/gpt-5.4-pro)
- [GPT-5.2 Pro](https://developers.openai.com/api/docs/models/gpt-5.2-pro)

