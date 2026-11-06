# Model pricing audit: 2026-09-30

Verified against live official documentation on 2026-09-30. Prices are USD per
million tokens. These are API-equivalent estimates, not subscription invoices.
Existing renderer changes are preserved.

## Added model families and variants

| Model | Input | Cache read | Cache write | Output | Source |
| --- | ---: | ---: | ---: | ---: | --- |
| GPT-6 Sol | 2 | 0.20 | 2.50 | 10 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| GPT-6.1 Sol | 2 | 0.10 | 2.50 | 10 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| GPT-6 Luna | 0.10 | 0.01 | 0.125 | 0.50 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| Claude Sonnet 5.5 | 2 | 0.20 | 2.50 | 10 | [Cursor](https://cursor.com/docs/models/claude-sonnet-5-5) |
| Claude Opus 5.5 | 4 | 0.20 | 5 | 20 | [Cursor](https://cursor.com/docs/models/claude-opus-5-5) |
| Claude Opus 5.5 Fast | 8 | 0.40 | 10 | 40 | [Cursor](https://cursor.com/docs/models/claude-opus-5-5) |
| Claude Fable 5.1 | 10 | 0.25 | 12.50 | 50 | [Cursor](https://cursor.com/docs/models/claude-fable-5-1) |
| Grok 4.7 | 2 | 0.50 | Not separately listed | 6 | [Cursor](https://cursor.com/docs/models/grok-4-7) |
| Grok 4.7 Fast | 4 | 1 | Not separately listed | 12 | [Cursor](https://cursor.com/docs/models/grok-4-7) |
| Muse Spark 1.3 | 1.25 | 0.15 | 0 | 4.25 | [Cursor](https://cursor.com/docs/models/muse-spark-1-3) |
| Gemini 3.1 Pro | 2 | 0.20 | Not separately listed | 12 | [Cursor](https://cursor.com/docs/models/gemini-3-1-pro) |

Also filled in the missing Claude Opus 5 thinking-high and other effort aliases
at $5 input / $0.50 cache read / $6.25 five-minute cache write / $25 output,
using [Anthropic's model specifications](https://platform.claude.com/docs/en/models/opus-5/overview).
Explicit family/effort aliases are used instead of guessing from arbitrary names.
There are 92 source-backed rows in `src/model-prices.ts`, including these aliases.

## Context and cache accounting

- GPT-6 Sol, GPT-6.1 Sol and GPT-6 Luna: above 272,000 input tokens, apply 2x
  input/cache and 1.5x output pricing to the entire request. Use Standard prices
  when the logs do not identify another service tier; reasoning effort is not a
  Fast service tier.
- Grok 4.7: above 256,000 prompt tokens, Standard becomes $4 / $1 / $12
  (input/read/output); Fast becomes $6 / $1.50 / $18. Output length does not
  trigger the threshold. All four effort settings retain their speed tier.
- Gemini 3.1 Pro: above 200,000 prompt tokens, input/read/output become
  $4 / $0.40 / $18, confirmed by [Google's pricing table](https://ai.google.dev/gemini-api/docs/pricing).
- Cursor prompt length is uncached input + cache writes + cache reads. Claude
  5.5 and Muse Spark 1.3 do not receive an invented long-context surcharge.
- A missing cache-write rate retains the existing ordinary-input fallback.
  Muse's explicit zero is preserved. Anthropic writes use the five-minute rate
  because Cursor CSV does not expose cache lifetime.
- Codex `reasoning_output_tokens` is a subset of `output_tokens`. In the initial
  September snapshot, all 11,956 nonzero-reasoning events satisfied
  `total_tokens == input_tokens + output_tokens`; none required adding reasoning
  again. Removed the duplicate reasoning charge, without changing token totals.
- Codex logs do not expose a separate cache-write token count. Price only the
  visible uncached input, cached input and output; do not invent cache writes.
- Current built-in rows precede legacy downloaded JSON for equal billing
  contexts. Source-specific context ranking remains intact.

## Live regression snapshot

Window: 2026-09-01 through 2026-09-30, Asia/Shanghai. Today's logs continue to
grow; these counts describe the generated audit snapshot, not a frozen month.

- Codex: 13,136 events; 12,921 priced, 215 unpriced (`unknown`, `codex-auto-review`).
- Cursor: 445 exported events, all matched to the updated or existing mapping.
- Estimated costs in this snapshot: Codex $2,560.26, Cursor $356.16. Unpriced
  Codex events are excluded, not proven free.
- Token totals remain unchanged by the pricing update: Codex 2,533,775,308;
  Cursor 1,257,957,387.
- Reproducible event and daily CSV files are under `reports/pricing-audit-2026-09-30`.
- `npm test`: 9 tests passed. `npm run check` and `npm run build`: passed.
- Installed payload updated in `%LOCALAPPDATA%/Programs/Tokn/resources/app`.
  All 18 build files matched their installed SHA-256 hashes after copying.
  Only the installed Tokn processes were stopped; user data and auto-start
  configuration were preserved. The installed tray app was restarted.
- Production browser preview at `http://127.0.0.1:5173/` loaded live data with
  no captured console errors. Default dates remain 2025-09-30 to 2026-09-30,
  Asia/Shanghai. September's displayed cost was $2,917.73 at browser verification;
  the small increase over the audit snapshot reflects ongoing usage.

## Limits

The external JSON still supplies older models and legacy Auto estimates.
Hidden Auto routing does not establish an underlying model. Pricing does not
reconstruct historical promotional periods, negotiated fees, Fast tiers absent
from logs, cache storage hours, tool charges, taxes or data-residency uplifts.
The Teams/Enterprise Cursor Token Rate is not applied without plan evidence.
The UI's USD figures are estimates of model usage, not actual subscription spend.
