# Cursor DeepSeek V4.1 Flash 1017 pricing

Verified on 2026-11-06 against the [Cursor model page](https://cursor.com/docs/models/deepseek-v4-1-flash-1017)
and [Models & Pricing](https://cursor.com/docs/models-and-pricing).

## Rates and aliases

Prices are USD per million tokens for Cursor's hosted model. These estimates
use Cursor's rates, rather than DeepSeek's direct-API rates or subscription
charges reported in the usage export.

| Input | Cache read | Cache write | Output |
| ---: | ---: | --- | ---: |
| 0.30 | 0.006 | Not separately listed | 1.20 |

The rate is flat throughout the documented 1M-token context window. Cursor
documents None, Low, Medium, High and Max reasoning levels with a single rate
table; there is no effort multiplier or long-context surcharge.

The canonical ID is `deepseek-v4.1-flash-1017`. Cursor usage exports use
`deepseek-v41-flash-1017` and effort suffixes `-none`, `-low`, `-medium`,
`-high` and `-max`. These names are explicitly mapped. Unverified Fast or
other version names remain unresolved.

The unspecified cache-write rate retains Tokn's existing ordinary-input
fallback: exported cache-write input is valued at $0.30/M, with no separate
write surcharge. It is not treated as a discounted cache read.

## Authentication and partial reports

Cursor now stores its Windows login token in a `cursor-safe-storage:v1:`
envelope. Sending this encrypted value as a dashboard session token produces
HTTP 401. Tokn reads the profile key from Cursor's Local State and uses Windows
DPAPI plus authenticated decryption to recover the token in memory. Cursor's
credential files are opened read-only; credentials and profile keys are not
written to reports or committed to this repository.

If Cursor cannot load, the report retains Codex usage and includes a warning
in the tray panel, CLI and Markdown export. Totals explicitly exclude the
unavailable source. Cursor requests have a 15-second timeout.

## Validation

- Pricing tests cover every documented reasoning level, ordinary-input
  fallback for cache writes, flat long-context pricing and unknown variants.
- Authentication tests cover plaintext and Windows-encrypted storage, as well
  as unreadable ciphertext.
- Report and renderer tests verify that Cursor authentication failures preserve
  Codex data and visibly qualify partial totals.
- `npm run check`, `npm test` (22 tests) and `npm run build` passed.
- A fresh Cursor export for 2026-10-31 through 2026-11-06 (Asia/Shanghai)
  contained 232 requests. All 232 now match a price; the 122 DeepSeek requests
  that previously had no price are covered. An independent calculation from
  the exported input, cache-write, cache-read and output columns agrees with
  the pricing engine for all four observed DeepSeek effort names.
- The local installation was updated to 0.1.2 and restarted. All 19 installed
  payload files match the staged build hashes. This is a local install, not a
  published installer release.
