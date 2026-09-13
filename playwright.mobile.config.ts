import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: ["mobile-experience.mobile.spec.ts"],
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
    { name: "android-chromium", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
