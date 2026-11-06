# Cursor Auto：如何区分 Grok 4.5 与 Grok 4.6（2026-08-26）

## 结论

如果一条隐藏底层模型的 Auto 请求只暴露出 `$2/M input`、`$0.50/M cache read`、`$6/M output` 这一标准价格档，**仅凭 Token 与费用无法区分 Cursor Grok 4.5 和 Cursor Grok 4.6**。Cursor 官方定价表显示两者标准档的三项价格完全相同，且上下文窗口也同为 256k。

对已经发生的请求，可靠的确认方式只有：

1. 团队管理员让 Router 显示 underlying model（适用于 Teams/Enterprise 的 Balance、Intelligence）；或
2. 复制该次请求的 Request ID，交给 Cursor Support 查询后端路由记录。

如果这两条都不可用，而 Dashboard/API 返回 `default` / `auto` 且 `showRoutedModel: false`，公开信息不足以把该请求精确归为 4.5 或 4.6。

## 已确认事实

### 1. 两个标准档价格完全相同

Cursor 官方 Models & Pricing 表列出：

| 模型 | Input | Cache read | Output |
|---|---:|---:|---:|
| Cursor Grok 4.5 | $2/M | $0.50/M | $6/M |
| Cursor Grok 4.6 | $2/M | $0.50/M | $6/M |

来源：[Cursor Models & Pricing](https://cursor.com/docs/models-and-pricing)、[Grok 4.5 模型页](https://prod.cursor.com/docs/models/grok-4-5)、[Grok 4.6 模型页](https://prod.cursor.com/docs/models/grok-4-6)。

因此，观测到 `$2 / $0.50 / $6` 只能证明其符合这两个模型共享的标准价格档，不能识别具体版本。

### 2. Fast 档只有输出价格不同，但不能反推这次标准档请求

官方价格为：

| Fast 模型 | Input | Cache read | Output |
|---|---:|---:|---:|
| Grok 4.5 Fast | $4/M | $1/M | $18/M |
| Grok 4.6 Fast | $4/M | $1/M | $12/M |

理论上，如果未来某条记录明确按 Fast 档计费，并且精确费用足以分离输出项，则输出费率可以区分 4.5 Fast 与 4.6 Fast。但本次记录吻合 `$2 / $0.50 / $6` 标准档，这个差异对本次识别无帮助。

### 3. Cursor Router 的模型池会变化，不能按日期或“当前主推模型”倒推

Cursor 官方 Router 文档称，路由池由 Cursor 管理，模型会随新模型发布而变化，用户不能手选 Auto 实际处理该请求的模型。官方论坛工作人员 Dean Rie 也表示，Cursor 不维护公开的实时 Auto 模型池列表，模型集合会依计划与容量动态变化。

来源：[Cursor Router 文档](https://prod.cursor.com/docs/cursor-router)、[Cursor Forum 员工回复](https://forum.cursor.com/t/which-models-are-behind-cursor-auto-mode/167010/4)。

Grok 4.6 于 2026-08-12 上线，但官方同时明确 Grok 4.5 继续可用；因此“请求发生在 4.6 上线后”不能证明该请求就是 4.6。

来源：[Grok 4.6 官方发布帖](https://forum.cursor.com/t/grok-4-6-is-now-live/168189)。

当前官方页面之间还有一个值得警惕的时效差异：[Available Models](https://prod.cursor.com/help/models-and-usage/available-models) 的 Router 池说明仍点名 Grok 4.5，而 [Grok 4.6 帮助页](https://cursor.com/help/models-and-usage/grok-4-6) 明确写着 Auto 在 4.6 上线时使用默认 high effort。前者可能尚未同步更新，因此不能把任一静态池列表当成某条历史请求的身份记录。

### 4. 管理员可以让 Router 显示底层模型

Cursor 官方 Router 文档说明，团队管理员可配置 `Underlying model` 为显示或隐藏；隐藏是默认值。该选项会在每次响应开始处显示 Auto 实际路由到的模型，但官方注明它适用于 Balance 和 Intelligence 模式。

来源：[Cursor Router 文档](https://prod.cursor.com/docs/cursor-router)、[Cursor Router changelog](https://cursor.com/changelog/router)。

### 5. Cursor Support 可以凭 Request ID 查看路由

在官方论坛的 Auto 缓存问题中，Cursor 工作人员 Dean Rie 明确要求用户提供受影响请求的 Request ID，并表示可以据此检查该请求被路由到了哪个模型。Request ID 可从聊天右上角菜单复制。

来源：[Cursor Forum 员工回复与操作说明](https://forum.cursor.com/t/auto-mode-prompt-caching-not-working/154654/10)。

这是一条可用于确认**既有请求**的官方支持路径，但是否会向用户披露具体模型仍取决于 Support 的处理和团队策略。

还有一个官方论坛已经验证的限制：如果该请求发生时开启了 Privacy Mode，Cursor Support 可能无法读取足够的后端详情。Cursor 员工曾明确表示 Privacy Mode 会阻止他们查看 Request ID 对应的细节，并建议关闭 Privacy Mode 后在新对话里复现并提供新的 Request ID。来源：[Cursor Forum 员工回复](https://forum.cursor.com/t/cursor-no-longer-caching-tokens-in-auto-mode/149782/7)。这意味着 Privacy Mode 下已经完成的历史请求未必能够事后精确恢复模型身份；不要为了排查而在关闭隐私保护时发送敏感代码。

### 6. SDK 的 `auto-smart` 也不是 resolved-model 字段

Cursor SDK 文档公开的 Router 选择是模型 ID `auto-smart` 加 `optimize_for` 参数；`Cursor.models.list()` 用于发现 Router 与可选模式。公开文档没有提供一个绕过团队隐藏设置、返回底层 resolved model 的字段或原始推理接口。因此读到 `auto-smart`、`auto` 或 `default` 只能确认选择了自动路由，不能确认具体版本。

来源：[Cursor Python SDK](https://prod.cursor.com/docs/sdk/python)。

### 7. 社区提出的本地 SQLite 方法在本次请求上没有留下模型身份

Cursor 论坛用户提出，可在 `%APPDATA%\Cursor\User\globalStorage\state.vscdb` 的 `cursorDiskKV` 表中读取 `bubbleId:<composerId>:<bubbleId>`，部分版本或会话会保存 `modelInfo.modelName`。本机只读验证确认目标对话 `3188ed36-922b-468c-96ec-0a62c8f55c16` 及其气泡记录存在，但目标 Auto 回合的气泡没有 `modelInfo.modelName`，`requestId` 字段也是空值。因此该社区方法无法识别本次请求。

来源：[Cursor Forum 社区方法与官方“当前不可见”回复](https://forum.cursor.com/t/show-which-model-handled-each-step-when-using-auto-mode/164163)。该方法属于非官方、本地实现相关线索，只有实际读到具体模型 slug 时才可作为补充证据。

### 8. 价格、回答风格和能力测试不是可靠指纹

Grok 4.6 官方说明它基于与 4.5 相同的底座，并改进长任务、指令遵循和视觉/交互工作；这些是总体能力特征，不是单次随机输出的可验证身份标记。两者上下文窗口均为 256k，而且 Auto 启动时对 4.6 使用默认 high effort；4.5 默认同样为 high effort。

来源：[Grok 4.5 模型页](https://prod.cursor.com/docs/models/grok-4-5)、[Grok 4.6 帮助页](https://prod.cursor.com/help/models-and-usage/grok-4-6)。

## 可执行方案

### 精确确认这次历史请求

1. 在对应 Cursor 对话右上角选择 **Copy Request ID**。
2. 向 Cursor Support 提交该 ID，说明 Dashboard/API 仅返回 `auto/default`，请求确认其 resolved model 是 `grok-4.5` 还是 `grok-4.6`。
3. 如果公司使用 Teams/Enterprise Router，请同时请管理员把 **Underlying model** 改为 **Displayed**；这主要解决之后的 Balance/Intelligence 请求可见性。

如果 Support 表示 Privacy Mode 阻止查询，只能在不含敏感内容的新对话中做一次受控复现：临时按公司政策调整 Privacy Mode、保留新的 Request ID，再让 Support 查询。旧请求是否仍可追溯取决于 Cursor 后端保留的数据，公开资料没有保证。

推荐支持消息：

> Could you confirm the resolved model for this Auto request ID: `<REQUEST_ID>`? The usage endpoint only exposes `auto/default`, while the token cost matches the shared standard Grok price tier ($2/M input, $0.50/M cache read, $6/M output). I need to know whether it was Cursor Grok 4.5 or Cursor Grok 4.6.

### 保证以后知道模型

- 需要可复现比较时，直接在模型选择器里指定 Grok 4.5 或 4.6。Cursor 官方论坛员工称，这是保证模型身份最可靠的方法：[官方回复](https://forum.cursor.com/t/composer-2-vs-auto-model-pricing/157665/10)。
- Teams/Enterprise 管理员可打开 routed-model 显示，并通过服务端模型访问控制限制路由池；个人客户端的 Models 勾选框只控制模型是否出现在选择器中，不会限制 Auto。来源：[官方员工说明](https://forum.cursor.com/t/what-does-the-auto-mode-of-cursor-mean/163291/10)。

## 推断与不可知项

### 合理推断

- 这次费用非常精确地吻合 Cursor Grok 的标准价格档，因此称其为“Grok 4.5/4.6 标准档”是合理的价格归类。
- 4.6 已上线且 Auto 在 4.6 上线时使用 high effort，说明 4.6 可能在 Auto 池中，但官方没有公布每个账户、每个时刻的实际池权重。

### 不能由公开数据确定

- 该历史请求究竟是 Grok 4.5 还是 Grok 4.6。
- Router 在该请求发生时对两者的权重、容量和分类评分。
- 根据语言风格、响应耗时、工具调用轨迹或模型自述判断版本；这些都不是官方提供的身份凭证。
- `default`、`auto`、费用公式或 `showRoutedModel: false` 本身不包含可解码的具体模型版本。

## 证据强度说明

- 价格、Router 设置、模型池动态性：Cursor 官方文档或官方 changelog，强证据。
- Request ID 可供 Cursor 查看路由：Cursor 官方论坛工作人员回复，较强的一手操作证据。
- 通过本地 SQLite `modelInfo.modelName` 查 resolved model 的说法来自论坛普通用户而非 Cursor 员工，本记录未将其作为确定结论。若本地实测能在目标请求对应记录中读到非 `default` 的具体 slug，才可作为补充证据；否则不能据此断言。
