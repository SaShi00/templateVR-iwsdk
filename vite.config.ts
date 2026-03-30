import { iwsdkDev } from "@iwsdk/vite-plugin-dev";

import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

import {
  MULTIPLAYER_PATH,
  MULTIPLAYER_SERVER_PORT,
} from "./src/multiplayerProtocol";

export default defineConfig({
  plugins: [
    mkcert(),
    iwsdkDev({
      emulator: {
        device: "metaQuest3",
      },
      ai: { tools: ["copilot"] },
      verbose: true,
    }),

    compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true }),
  ],
  server: {
    host: "0.0.0.0",
    port: 8081,
    open: true,
    proxy: {
      [MULTIPLAYER_PATH]: {
        target: `ws://127.0.0.1:${MULTIPLAYER_SERVER_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
    target: "esnext",
    rollupOptions: { input: "./index.html" },
  },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
    esbuildOptions: { target: "esnext" },
  },
  publicDir: "public",
  base: "./",
});
