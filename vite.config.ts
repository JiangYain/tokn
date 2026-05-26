import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import * as electronSimpleModule from "vite-plugin-electron/simple";
import * as electronRendererModule from "vite-plugin-electron-renderer";
import { tokenMonitorLocalApiPlugin } from "./src/vite-local-api.js";

const electron = electronSimpleModule.default as unknown as (options: unknown) => Promise<unknown[]>;
const renderer = electronRendererModule.default as unknown as (options?: unknown) => unknown;

const electronPlugins = (await electron({
  main: {
    entry: "src/electron/main.ts",
  },
  preload: {
    input: "src/electron/preload.ts",
  },
  renderer: {},
})) as PluginOption[];
const rendererPlugin = renderer() as PluginOption;

export default defineConfig({
  plugins: [tokenMonitorLocalApiPlugin(), react(), ...electronPlugins, rendererPlugin],
  server: {
    port: 5173,
  },
  clearScreen: false,
});
