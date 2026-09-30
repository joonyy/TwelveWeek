import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5179",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --env-file-if-exists=.env tests/browser-server.js",
      url: "http://127.0.0.1:4111/api/health",
      reuseExistingServer: false,
    },
    {
      command: "TWELVE_API_PORT=4111 TWELVE_WEB_PORT=5179 npm run dev:web",
      url: "http://127.0.0.1:5179",
      reuseExistingServer: false,
    },
  ],
});
