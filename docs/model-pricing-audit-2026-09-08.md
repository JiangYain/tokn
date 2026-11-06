# Gemini 3.8 Flash pricing audit

Audited: 2026-09-08 (Asia/Shanghai)

## Recommendation for Tokn

Tokn estimates Cursor usage, so the Cursor-published rate is the controlling price for Cursor events even where Google's direct API list price differs.

Map all three locally exposed Cursor effort aliases to the same canonical model and price:

| Observed Cursor model | Canonical model | Input | Cache write | Cache read | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| `gemini-3.8-flash-low` | `gemini-3.8-flash` | $0.75 | $0.75 | $0.075 | $3.50 |
| `gemini-3.8-flash-medium` | `gemini-3.8-flash` | $0.75 | $0.75 | $0.075 | $3.50 |
| `gemini-3.8-flash-high` | `gemini-3.8-flash` | $0.75 | $0.75 | $0.075 | $3.50 |

All token prices are USD per million tokens. Cursor publishes one model ID and one price table for all three effort levels, so effort changes token volume and latency rather than the per-token rate.

For `cache_write_price`, Cursor's table shows `-`, not a separate discounted write rate. Tokn should therefore value any exported cache-write tokens at the ordinary input rate, `$0.75/M`, rather than at zero or the cached-read rate. This also matches Google's accounting model: cache creation consumes ordinary input, while explicit cache persistence can additionally incur time-based storage charges. Tokn's event format has no token-hour dimension, so storage cost cannot be reconstructed from a one-time cache-write token count and should not be added.

## Official price comparison

| Source and billing context | Input | Cache write | Cache read | Output | Effective period |
| --- | ---: | ---: | ---: | ---: | --- |
| Cursor third-party model pricing | $0.75 | Not separately listed | $0.075 | $3.50 | Current as checked 2026-09-08; no end date stated |
| Google Gemini Developer API, Standard | $0.75 | Ordinary input price; explicit storage is separate | $0.075 | $3.75, including thinking tokens | Introductory rate through 2026-12-31 |
| Google Gemini Developer API, Standard | $1.50 | Ordinary input price; explicit storage is separate | $0.15 | $7.50, including thinking tokens | From 2027-01-01 |

Google's explicit-cache storage rate is `$0.50/M token-hours` through 2026-12-31 and `$1.00/M token-hours` from 2027-01-01. Cursor does not publish a corresponding storage line for its Gemini 3.8 Flash integration.

The `$3.50` versus `$3.75` output difference is real in the two current official tables. Since this application is pricing Cursor-exported records, use Cursor's `$3.50` output rate for the Cursor aliases rather than silently substituting Google's direct-API rate.

## Model and effort evidence

- Cursor documents model ID `gemini-3.8-flash`, with `high` (Cursor default), `medium`, and `low` effort levels, followed by a single pricing table. [Cursor Gemini 3.8 Flash model page](https://prod.cursor.com/docs/models/gemini-3-8-flash)
- Cursor's consolidated table lists Gemini 3.8 Flash at `$0.75` input, `-` cache write, `$0.075` cache read, and `$3.50` output per million tokens. [Cursor Models & Pricing](https://cursor.com/docs/models-and-pricing)
- Google likewise exposes one stable model ID, `gemini-3.8-flash`. It supports `low`, `medium`, and `high`; `minimal` is unsupported and returns an error. [Google Gemini 3.8 Flash model specification](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- Google calls `medium` the API default and confirms that output pricing includes thinking tokens. It announces the introductory rate through 2026-12-31 and standard pricing from 2027-01-01. [Google Gemini 3.8 Flash launch guide](https://ai.google.dev/gemini-api/docs/latest-model)
- Google's full Standard table supplies input, cached-input, output, and cache-storage rates. [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Google documents implicit cache hits separately from explicit cache storage and reports cached-token usage in response metadata. [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)

## Local observations

For the local Cursor data covering 2026-09-01 through 2026-09-08:

- The CSV contains 48 records under `gemini-3.8-flash-high`, totaling 30,955,845 tokens.
- The first observed record is `2026-09-03T02:29:24.359Z`; the latest is `2026-09-08T04:38:48.807Z`.
- Cursor's local `state.vscdb` model catalog exposes the exact legacy slugs `gemini-3.8-flash-low`, `gemini-3.8-flash-medium`, and `gemini-3.8-flash-high`.
- Neither the local catalog nor Google's official model specification supports a `minimal` variant. Do not add a speculative `gemini-3.8-flash-minimal` mapping.

Only `high` has appeared in the current CSV, but pre-registering the two catalog-confirmed `low` and `medium` aliases prevents otherwise identical future usage from becoming unpriced.
