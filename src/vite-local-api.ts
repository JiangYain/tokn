import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { generateReport, getAppDefaults, inspectCursorAuth } from "./service.js";
import type { AppReportOptions } from "./contracts.js";

const API_PREFIX = "/__token-monitor";

export function tokenMonitorLocalApiPlugin(): Plugin {
  return {
    name: "token-monitor-local-api",
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}

function installMiddleware(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (req, res, next) => {
    const url = req.url ? new URL(req.url, "http://localhost") : null;
    const pathname = url?.pathname;

    if (!pathname?.startsWith(API_PREFIX)) {
      next();
      return;
    }

    try {
      if (pathname === `${API_PREFIX}/defaults` && req.method === "GET") {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        sendJson(res, 200, getAppDefaults(timezone));
        return;
      }

      if (pathname === `${API_PREFIX}/report` && req.method === "POST") {
        const body = (await readJsonBody(req)) as AppReportOptions;
        const result = await generateReport(body);
        sendJson(res, 200, result);
        return;
      }

      if (pathname === `${API_PREFIX}/cursor-auth` && req.method === "POST") {
        const body = (await readJsonBody(req)) as AppReportOptions;
        const result = inspectCursorAuth(body);
        sendJson(res, 200, result);
        return;
      }

      if (pathname === `${API_PREFIX}/pick-directory`) {
        sendJson(res, 501, { error: "Directory picking is only available in Electron." });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}
