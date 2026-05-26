import path from "node:path";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, Tray } from "electron";
import type { Rectangle } from "electron";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { CZ_LOGO_TRAY_VIEW_BOX, getCzLogoSvgMarkup } from "../branding/cz-logo.js";
import type { AppReportOptions } from "../contracts.js";
import { generateReport, getAppDefaults, inspectCursorAuth } from "../service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 328;
const PANEL_MARGIN = 10;
const PANEL_EDGE_MARGIN = 4;

let panelWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let lastTrayBounds: Rectangle | null = null;
let staticServer: Server | null = null;
let staticServerUrl: string | null = null;

async function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    return panelWindow;
  }

  const window = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Tokn",
    backgroundColor: "#ffffff",
    hasShadow: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWindow = window;

  window.on("blur", () => {
    if (!isQuitting) {
      window.hide();
    }
  });

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on("closed", () => {
    if (panelWindow === window) {
      panelWindow = null;
    }
  });

  await window.loadURL(await getRendererEntryUrl());

  return window;
}

async function getRendererEntryUrl() {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }

  return ensureStaticServer();
}

async function ensureStaticServer() {
  if (staticServerUrl) {
    return staticServerUrl;
  }

  const distDir = path.resolve(__dirname, "../dist");

  staticServer = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
      const relativePath = pathname.replace(/^\/+/, "");
      const resolvedPath = path.resolve(distDir, relativePath);

      if (!resolvedPath.startsWith(distDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const body = await readFile(resolvedPath);
      response.writeHead(200, { "Content-Type": getContentType(resolvedPath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    staticServer?.once("error", reject);
    staticServer?.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = staticServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Static server failed to bind to a local port");
  }

  staticServerUrl = `http://127.0.0.1:${address.port}`;
  return staticServerUrl;
}

async function createTray() {
  const image = await createTrayImage();
  image.setTemplateImage(false);

  const nextTray = new Tray(image);
  nextTray.setToolTip("Tokn");
  nextTray.on("right-click", (_event, bounds) => {
    lastTrayBounds = bounds;
    void showPanel(bounds);
  });
  nextTray.on("click", (_event, bounds) => {
    lastTrayBounds = bounds;
    void showPanel(bounds);
  });

  return nextTray;
}

async function showPanel(bounds?: Rectangle) {
  try {
    const window = await createPanelWindow();
    positionPanelWindow(window, bounds ?? lastTrayBounds ?? undefined);
    window.show();
    window.focus();
    window.moveTop();
  } catch (error) {
    console.error("Failed to show Tokn panel", error);
    dialog.showErrorBox("Tokn", "The tray app is running, but the panel failed to open.");
  }
}

function positionPanelWindow(window: BrowserWindow, bounds?: Rectangle) {
  const anchor = getAnchorPoint(bounds);
  const display = screen.getDisplayNearestPoint(anchor);
  const { bounds: screenBounds } = display;
  const width = Math.min(PANEL_WIDTH, Math.max(1, screenBounds.width - PANEL_EDGE_MARGIN * 2));
  const height = Math.min(PANEL_HEIGHT, Math.max(1, screenBounds.height - PANEL_EDGE_MARGIN * 2));
  const minX = screenBounds.x + PANEL_EDGE_MARGIN;
  const maxX = screenBounds.x + screenBounds.width - width - PANEL_EDGE_MARGIN;
  const minY = screenBounds.y + PANEL_EDGE_MARGIN;
  const maxY = screenBounds.y + screenBounds.height - height - PANEL_EDGE_MARGIN;
  const preferredX = maxX;
  const preferredY = maxY;

  window.setBounds({
    x: Math.round(clamp(preferredX, minX, maxX)),
    y: Math.round(clamp(preferredY, minY, maxY)),
    width,
    height,
  });
}

function getAnchorPoint(bounds?: Rectangle) {
  if (bounds && (bounds.width > 0 || bounds.height > 0)) {
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
  }
  return screen.getCursorScreenPoint();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function createTrayImage() {
  try {
    const traySvgMarkup = getCzLogoSvgMarkup({ viewBox: CZ_LOGO_TRAY_VIEW_BOX });
    const image = await renderSvgToTrayImage(traySvgMarkup);
    if (!image.isEmpty()) {
      return image;
    }
  } catch {
    // Fall through to the compact fallback glyph.
  }

  return createFallbackTrayImage();
}

async function renderSvgToTrayImage(svgMarkup: string) {
  const iconWindow = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = [
    "<!doctype html>",
    "<html>",
    "<body style=\"margin:0;display:grid;place-items:center;width:100vw;height:100vh;background:transparent;overflow:hidden;\">",
    svgMarkup.replace("<svg ", "<svg width=\"64\" height=\"64\" "),
    "</body>",
    "</html>",
  ].join("");

  try {
    const imagePromise = new Promise<Electron.NativeImage>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Tray icon paint timeout")), 3000);
      iconWindow.webContents.once("paint", (_event, _dirty, image) => {
        clearTimeout(timeout);
        resolve(image);
      });
    });

    await iconWindow.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
    return (await imagePromise).resize({ width: 20, height: 20, quality: "best" });
  } finally {
    iconWindow.destroy();
  }
}

function createFallbackTrayImage() {
  const size = 20;
  const bitmap = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const inTile = x >= 2 && x <= 17 && y >= 2 && y <= 17;
      const inAccent = x >= 10 && x <= 13 && y >= 3 && y <= 16;

      if (inTile) {
        bitmap[offset] = 17;
        bitmap[offset + 1] = 17;
        bitmap[offset + 2] = 17;
        bitmap[offset + 3] = 255;
      }

      if (inAccent) {
        bitmap[offset] = 217;
        bitmap[offset + 1] = 70;
        bitmap[offset + 2] = 50;
        bitmap[offset + 3] = 255;
      }
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: 1 });
}

function toSvgDataUrl(svgMarkup: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svgMarkup).toString("base64")}`;
}

function getContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void showPanel(lastTrayBounds ?? undefined);
  });

  app.whenReady().then(async () => {
    app.setName("Tokn");

    ipcMain.handle("app:get-defaults", async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      return getAppDefaults(timezone);
    });

    ipcMain.handle("app:pick-directory", async (_event, currentPath?: string) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        defaultPath: currentPath,
      });
      return result.canceled ? null : result.filePaths[0] || null;
    });

    ipcMain.handle("report:run", async (_event, options: AppReportOptions) => {
      return generateReport(options);
    });

    ipcMain.handle("cursor:inspect-auth", async (_event, options: AppReportOptions) => {
      return inspectCursorAuth(options);
    });

    tray = await createTray();

    app.on("activate", () => {
      void showPanel(lastTrayBounds ?? undefined);
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
    staticServer?.close();
  });

  app.on("window-all-closed", () => {
    // Tray-first app: keep the process alive with no open windows.
  });
}
