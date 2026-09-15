import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: ["pinterestDescription.spec.ts", "facebook.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:3107", trace: "retain-on-failure" },
  webServer: {
    cwd: resolve(__dirname, "../.."),
    command: "node tests/browser/start-server.mjs",
    url: "http://127.0.0.1:3107/login",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
