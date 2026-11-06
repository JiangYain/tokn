# 2026-08-16 模型价格审计

## 结论

本审计读取 Tokn 现有报告链路在 `2026-08-01` 至 `2026-08-16`（`Asia/Shanghai`）期间生成的本机 Codex 与 Cursor 明细，并只采用 OpenAI、Anthropic、Google、xAI 和 Cursor 的官方资料。价格均为 **USD / 1M tokens**。

需要新增或修改的确定项：

| 本机观测名称 | 规范模型 | 输入 | 缓存写入 | 缓存读取 | 输出 | 建议 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `gpt-5.6-terra` | `gpt-5.6-terra` | 2.00 | 2.50 | 0.20 | 12.00 | **更新旧价**。 |
| `gpt-5.6-luna` | `gpt-5.6-luna` | 0.20 | 0.25 | 0.02 | 1.20 | **更新旧价**；OpenAI 自 2026-07-30 起降价 80%。 |
| `claude-fable-5-thinking-high` | `claude-fable-5` | 10.00 | 12.50 | 1.00 | 50.00 | 新增 effort 别名。 |
| `gemini-3.7-flash-high` | `gemini-3.7-flash` | 0.75 | 未单列 | 0.075 | 3.50 | 新增 Cursor 别名；采用 Cursor 当前 Models & Pricing 表。 |
| `gemini-3.6-flash-high` | `gemini-3.6-flash` | 0.75 | 未单列 | 0.075 | 3.75 | 新增别名；Google 2026-12-31 前促销价。 |
| `cursor-grok-4.6-xhigh-fast` | Cursor Grok 4.6 Fast | 4.00 | 未单列 | 1.00 | 12.00 | 新增 Cursor Fast 别名。 |
| `cursor-grok-4.6-high-fast` | Cursor Grok 4.6 Fast | 4.00 | 未单列 | 1.00 | 12.00 | 同上；effort 不改变单 token 价。 |
| `claude-opus-5-thinking-max` | `claude-opus-5` | 5.00 | 6.25 | 0.50 | 25.00 | 新增 effort 别名。 |
| `composer-2.5` | Composer 2.5 | 0.50 | 未单列 | 0.20 | 2.50 | 新增标准版。 |
| `composer-2.5-fast` | Composer 2.5 Fast | 3.00 | 未单列 | 0.50 | 15.00 | **补充已公开的缓存读取价**。 |

Cursor 官方表还注明 Grok 4.6 从 2026-08-12 起有一周 50% 上线优惠。该优惠会过期，不应写死为长期模型单价；上表使用稳定的公开牌价。

下列现有映射已核对，无需改价：

| 本机观测名称 | 输入 | 缓存写入 | 缓存读取 | 输出 |
| --- | ---: | ---: | ---: | ---: |
| `gpt-5.6-sol` | 5.00 | 6.25 | 0.50 | 30.00 |
| `gpt-5.4` | 2.50 | 未单列 | 0.25 | 15.00 |
| `claude-fable-5-thinking-max` | 10.00 | 12.50 | 1.00 | 50.00 |
| `claude-4.6-opus-max-thinking` | 5.00 | 6.25 | 0.50 | 25.00 |

## 仍应保持未解析

| 本机观测名称 | 8 月 Token | 原因 |
| --- | ---: | --- |
| 空模型名 | 55,531,025 | 日志事件没有模型标识，不能安全归价。 |
| `codex-auto-review` | 7,128,207 | Codex 内部路由/产品别名；OpenAI 官方 API 模型目录没有同名计费模型，也没有公开实际路由组成。 |

不可把这两项回退到某个“可能相近”的 GPT 模型，否则会制造无法审计的费用。

## 8 月实际观测

报告命令：

```powershell
npm run report -- --from 2026-08-01 --to 2026-08-16 --timezone Asia/Shanghai --out-dir .tmp\pricing-audit-2026-08-16
```

报告读取 Codex 8,848 个事件、Cursor 476 个事件。

### Codex

| 模型 | 事件数 | Total tokens | 当前状态 |
| --- | ---: | ---: | --- |
| `gpt-5.6-sol` | 8,310 | 1,027,424,901 | 已映射，正确 |
| 空模型名 | 431 | 55,531,025 | 未解析 |
| `codex-auto-review` | 76 | 7,128,207 | 未解析 |
| `gpt-5.4` | 21 | 1,535,344 | 已映射，正确 |
| `gpt-5.6-luna` | 10 | 331,961 | **已映射但价格过时** |

### Cursor

| 模型 | 请求数 | Total tokens | 当前状态 |
| --- | ---: | ---: | --- |
| `claude-fable-5-thinking-max` | 162 | 1,239,083,289 | 已映射，正确 |
| `gemini-3.7-flash-high` | 139 | 460,460,199 | **应新增** |
| `claude-fable-5-thinking-high` | 35 | 211,625,240 | **应新增** |
| `cursor-grok-4.6-xhigh-fast` | 95 | 139,597,940 | **应新增** |
| `gemini-3.6-flash-high` | 34 | 68,375,761 | **应新增** |
| `claude-opus-5-thinking-max` | 2 | 42,017,215 | **应新增** |
| `composer-2.5-fast` | 3 | 10,908,620 | 已映射，但缺缓存读取价 |
| `claude-4.6-opus-max-thinking` | 1 | 1,519,832 | 已映射，正确 |
| `cursor-grok-4.6-high-fast` | 1 | 403,717 | **应新增** |
| `composer-2.5` | 4 | 364,915 | **应新增** |

## Cursor 当前官方价格表（与本次观测相关）

Cursor 的 [Models & Pricing](https://cursor.com/docs/models-and-pricing) 当前直接列出：

| Cursor 显示模型 | 输入 | 缓存写入 | 缓存读取 | 输出 |
| --- | ---: | ---: | ---: | ---: |
| Grok 4.6 | 2.00 | - | 0.50 | 6.00 |
| Grok 4.6 Fast | 4.00 | - | 1.00 | 12.00 |
| Composer 2.5 | 0.50 | - | 0.20 | 2.50 |
| Composer 2.5 Fast | 3.00 | - | 0.50 | 15.00 |
| Claude Fable 5 | 10.00 | 12.50 | 1.00 | 50.00 |
| Claude Opus 5 | 5.00 | 6.25 | 0.50 | 25.00 |
| Gemini 3.7 Flash | 0.75 | - | 0.075 | 3.50 |
| GPT-5.6 Luna | 0.20 | 0.25 | 0.02 | 1.20 |
| GPT-5.6 Sol | 5.00 | 6.25 | 0.50 | 30.00 |

Cursor 表把第三方模型按 API rate 计入 Other Models pool，把 Grok/Composer 计入 Cursor Models pool。团队与企业计划对第三方模型还可能另加 Cursor Token Rate；Tokn 的“API 等价成本”不应混入订阅计划附加费。

## 官方证据与边界

1. OpenAI [GPT-5.6 Luna 当前模型页](https://developers.openai.com/api/docs/models/gpt-5.6-luna)给出 $0.20 输入、$0.02 cached、$0.25 cache write、$1.20 输出；[GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)、[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)和 [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4)确认其现价。GPT-5.6 与 GPT-5.4 超过 272K prompt 后存在长上下文倍率，Tokn 当前聚合事件不足以可靠按请求应用。
2. Anthropic [模型总览](https://platform.claude.com/docs/en/about-claude/models/overview)确认 Fable 5 与 Opus 5 的 API ID 和基础价格；[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)规定 5 分钟写入 1.25x、1 小时写入 2x、读取 0.1x。effort 改变 token 量而非 token 单价。
3. Google [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)确认 Gemini 3.7/3.6 Flash 在 2026-12-31 前均为 $0.75 输入、$0.075 context caching、$3.75 输出，2027-01-01 起恢复 $1.50/$0.15/$7.50；缓存另有 $0.50/M token-hour（之后 $1/M token-hour）存储费。Cursor 自己的表把 3.7 输出列为 $3.50，因此 Cursor 事件按 Cursor 公布值，3.6 按 Google API 值。该差异应定期复核。
4. xAI [API Pricing](https://docs.x.ai/developers/pricing)给出 Grok 4.6 短上下文 $2/$0.50/$6、≥200K 时 $4/$1/$12；Cursor 官方表明确将 Fast 版本列为 $4/$1/$12，因此本机两个 `cursor-grok-4.6-*-fast` 可按 Cursor Fast 价映射。
5. Cursor [Composer 2.5 模型页](https://cursor.com/docs/models/cursor-composer-2-5)公开 cache read：标准 $0.20、Fast $0.50；cache write 仍为 `-`。

## 实现建议

- 对官方 `Cache Write = -` 的 Cursor 模型，字段应保留 `null`；当前估算器会回退到输入价，这是实现策略，不应描述成厂商公开的 cache-write 单价。
- Codex reasoning tokens 按 output token 价格计算，与仓库当前实现一致。
- Gemini 3.6/3.7 的促销价有截止日期。静态常量至少应注明需在 2027-01-01 更新；更稳妥的长期方案是支持生效日期。
- 不要给空模型名或 `codex-auto-review` 计价。
