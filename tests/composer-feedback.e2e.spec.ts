import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("send confirmation waits for success and a new draft immediately restores the send action", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
  const send = page.getByRole("button", { name: "Mesaj gönder", exact: true });
  const composer = page.locator(".composer-ux");
  const confirmation = composer.getByRole("status");
  await expect(input).toBeVisible();
  const text = `Onaylanan mesaj ${randomUUID()}`;
  await input.fill(text);
  const before = await send.boundingBox();
  expect(before).not.toBeNull();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/channels/*/messages", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  try {
    await send.click();
    await expect(send).toHaveAttribute("aria-busy", "true");
    await expect(send).toBeDisabled();
    await expect(confirmation).toHaveText("");
    await expect(send).not.toHaveClass(/is-sent/);
  } finally {
    release();
  }

  await expect(confirmation).toHaveText("Mesaj gönderildi.");
  await expect(send.getByText("Gönderildi", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(send).toBeDisabled();
  const after = await send.boundingBox();
  expect(after!.width).toBe(before!.width);
  await input.fill("Sonraki mesaj");
  await expect(confirmation).toHaveText("");
  await expect(send.getByText("Gönder", { exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  await expect(
    page.locator("p.message-text").filter({ hasText: text }),
  ).toHaveText(text);
});

test.describe("compact touch feedback", () => {
  test.use({
    viewport: { width: 320, height: 640 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });

  test("failed send keeps the draft and retry confirms briefly without shifting the touch controls", async ({
    page,
  }) => {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
    const send = page.getByRole("button", {
      name: "Mesaj gönder",
      exact: true,
    });
    const composer = page.locator(".composer-ux");
    const confirmation = composer.getByRole("status");
    await expect(input).toBeVisible();
    const text = `Yeniden gönderme ${randomUUID()}`;
    await input.fill(text);
    await page.route(
      "**/api/channels/*/messages",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Gönderilemedi. Yeniden dene." }),
        }),
      { times: 1 },
    );
    const before = await send.boundingBox();
    expect(before).not.toBeNull();
    expect(before!.width).toBeGreaterThanOrEqual(40);
    expect(before!.x + before!.width).toBeLessThanOrEqual(320);
    await send.tap();
    await expect(composer.getByRole("alert")).toContainText("Gönderilemedi");
    await expect(confirmation).toHaveText("");
    await expect(send).not.toHaveClass(/is-sent/);
    await expect(input).toHaveValue(text);
    await expect(send).toBeEnabled();

    await send.tap();
    await expect(confirmation).toHaveText("Mesaj gönderildi.");
    await expect(send).toHaveClass(/is-sent/);
    await expect(input).toHaveValue("");
    const after = await send.boundingBox();
    expect(after!.width).toBe(before!.width);
    expect(after!.x).toBe(before!.x);
    await expect(confirmation).toHaveText("");
    await expect(send).not.toHaveClass(/is-sent/);
    await expect(send).toBeDisabled();
    await expect(composer.getByRole("alert")).toHaveCount(0);
  });
});
