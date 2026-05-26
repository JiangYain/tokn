# Tokn

Tokn is a tray-first Windows desktop app for monitoring token usage from Codex and Cursor in one compact panel.

It is built with Electron, Vite, React, and TypeScript. The app lives in the Windows tray, opens as a lightweight bottom-right panel, and can install itself as a portable per-user app with startup enabled.

## What It Does

- Aggregates daily token usage from local Codex session data
- Pulls Cursor usage through the current local login session
- Shows a compact tray panel with:
  - today tokens
  - month tokens
  - today cost
  - month cost
  - activity heatmap
- Supports one-click refresh from the tray panel
- Can install into `%LOCALAPPDATA%\Programs\Tokn`
- Can register itself for current-user Windows startup

## Why This Exists

Codex and Cursor usage data are split across different local sources and web-facing exports. Tokn turns that into a single local-first desktop view that is always one click away from the system tray.

## Screenshots

The app is designed as a compact tray surface rather than a full dashboard window.

## Requirements

- Windows
- Node.js 22+
- npm

## Development

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm start
```

Build the renderer and Electron entrypoints:

```bash
npm run build
```

Type-check the project:

```bash
npm run check
```

## Reporting CLI

Generate a report:

```bash
npm run report -- --from 2026-05-01 --to 2026-05-25 --timezone Asia/Shanghai
```

Inspect Cursor auth discovery:

```bash
npm run cursor-auth
```

Useful options:

```text
--from YYYY-MM-DD
--to YYYY-MM-DD
--timezone Asia/Shanghai
--sources codex,cursor
--codex-root C:\Users\you\.codex
--out-dir C:\path\to\reports
--cursor-session-token YOUR_TOKEN
--cursor-cookie "WorkosCursorSessionToken=..."
--cursor-app-dir C:\Users\you\AppData\Roaming\Cursor
--cursor-cli-config C:\Users\you\.cursor\cli-config.json
```

## Portable Install

Install Tokn as a portable per-user app and enable Windows startup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-portable.ps1
```

That installs the app to:

```text
%LOCALAPPDATA%\Programs\Tokn
```

Manual launcher from the repo:

```text
Tokn.cmd
```

## Project Structure

```text
src/
  branding/          shared logo assets
  electron/          Electron main/preload entrypoints
  renderer/          React tray panel UI
  service.ts         usage aggregation orchestration
  pricing.ts         token pricing logic
scripts/
  install-portable.ps1
public/
  fonts/
```

## Cursor Caveat

Cursor support depends on an undocumented usage export flow:

- auth is reconstructed from the local Cursor login state
- usage is fetched from Cursor's dashboard export endpoint
- the endpoint, headers, cookie shape, or CSV schema may change without notice

If Cursor changes those internals, Codex reporting will keep working but Cursor reporting may need updates.

## License

MIT. See [LICENSE](./LICENSE).
