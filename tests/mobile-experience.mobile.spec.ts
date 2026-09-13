import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("phone Return keeps a multiline draft and explicit send posts it once", async ({
  page,
  isMobile,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
  await expect(composer).toBeVisible();
  const first = `Mobil merhaba ${Date.now()}`;
  await composer.fill(first);
  await composer.press("Enter");
  if (isMobile) {
    await expect(composer).toHaveValue(`${first}\n`);
    await expect(
      page.locator("p.message-text").filter({ hasText: first }),
    ).toHaveCount(0);
    await composer.press("End");
    await composer.press("x");
    await page.getByRole("button", { name: "Mesaj gönder", exact: true }).tap();
  }
  await expect(
    page.locator("p.message-text").filter({ hasText: first }),
  ).toHaveCount(1);
  await expect(composer).toHaveValue("");
  await page.reload();
  await expect(
    page.locator("p.message-text").filter({ hasText: first }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
  const directory = join(tmpdir(), "mola-mobile-qa");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${info.project.name}.png`),
    animations: "disabled",
  });
});

test("phone navigation and reply controls work with taps and no hover", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Touch navigation is exercised on the phone projects.");
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  const opener = page.getByRole("button", {
    name: "Gezinmeyi aç",
    exact: true,
  });
  await opener.tap();
  const sidebar = page.getByRole("dialog", {
    name: "Çalışma alanı gezinmesi",
    exact: true,
  });
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole("button", { name: "genel", exact: true }).tap();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  const composer = page.getByRole("textbox", {
    name: "#genel kanalına mesaj yaz",
    exact: true,
  });
  await expect(composer).toBeVisible();
  const text = `Dokunarak yanıt ${Date.now()}`;
  await composer.fill(text);
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).tap();
  const message = page
    .locator("article[data-message-id]")
    .filter({ hasText: text });
  await expect(message).toBeVisible();
  await message
    .getByRole("button", { name: "Diğer mesaj işlemleri", exact: true })
    .tap();
  await message
    .getByRole("button", { name: "Mesajı yanıtla", exact: true })
    .tap();
  const reply = page.getByRole("textbox", {
    name: "Yanıtını yaz",
    exact: true,
  });
  await expect(reply).toBeVisible();
  await reply.fill("Telefondan yanıt");
  await page.getByRole("button", { name: "Yanıt gönder", exact: true }).tap();
  await expect(
    page
      .locator(".thread-panel p.message-text")
      .filter({ hasText: "Telefondan yanıt" }),
  ).toHaveText("Telefondan yanıt");
  await expect(reply).toHaveValue("");
  await page
    .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
    .tap();
  await expect(composer).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("landscape phone keeps composer and send inside the visible viewport", async ({
  page,
  isMobile,
}) => {
  test.skip(
    !isMobile,
    "Landscape phone sizing is exercised on the phone projects.",
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
  await expect(composer).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-mobile-viewport",
    "true",
  );
  const send = page.getByRole("button", { name: "Mesaj gönder", exact: true });
  await expect
    .poll(async () => {
      const bounds = await send.boundingBox();
      return bounds ? bounds.y + bounds.height : Infinity;
    })
    .toBeLessThanOrEqual(391);
  expect(
    await composer.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

for (const orientation of ["portrait", "landscape"] as const) {
  test(`${orientation} keyboard leaves the composer usable and preserves pinch zoom`, async ({
    page,
    isMobile,
  }) => {
    test.skip(
      !isMobile,
      "Software keyboard layout is exercised on phone projects.",
    );
    if (orientation === "landscape")
      await page.setViewportSize({ width: 844, height: 390 });
    await page.addInitScript(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, { height: innerHeight, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });
    });
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
    await expect(composer).toBeVisible();
    await composer.focus();
    const height = orientation === "portrait" ? 420 : 220;
    await page.evaluate((height) => {
      Object.assign(window.visualViewport!, { height, offsetTop: 12 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
      const root = document.documentElement;
      root.style.setProperty("--mola-safe-top", "20px");
      root.style.setProperty("--mola-safe-right", "24px");
      root.style.setProperty("--mola-safe-bottom", "34px");
      root.style.setProperty("--mola-safe-left", "24px");
    }, height);
    await expect(page.locator("html")).toHaveAttribute(
      "data-mobile-keyboard",
      "true",
    );
    const send = page.getByRole("button", {
      name: "Mesaj gönder",
      exact: true,
    });
    await expect
      .poll(async () => {
        const bounds = await send.boundingBox();
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(height + 13);
    const bounds = await composer.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(32);
    expect(bounds!.x).toBeGreaterThanOrEqual(24);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width - 24,
    );
    await composer.fill(`Klavye açık ${orientation}`);
    await send.tap();
    await expect(
      page
        .locator("p.message-text")
        .filter({ hasText: `Klavye açık ${orientation}` }),
    ).toHaveCount(1);
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, {
        height: 180,
        offsetTop: 60,
        scale: 2,
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    expect(
      await page
        .locator("html")
        .evaluate((el) =>
          (el as HTMLElement).style.getPropertyValue("--mola-viewport-height"),
        ),
    ).toBe(`${height}px`);
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, {
        height: innerHeight,
        offsetTop: 0,
        scale: 1,
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-mobile-keyboard",
      "false",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}

test("native WebView resize keeps send reachable while editing in landscape", async ({
  page,
  isMobile,
}) => {
  test.skip(
    !isMobile,
    "Native keyboard resizing is exercised on phone projects.",
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
  await expect(composer).toBeVisible();
  await composer.focus();
  // Native safe-area / IME constraints resize the entire WebView, so layout and
  // visual viewport shrink together, unlike an overlaid browser keyboard.
  await page.setViewportSize({ width: 844, height: 220 });
  await composer.fill("Native klavye alanı");
  const send = page.getByRole("button", { name: "Mesaj gönder", exact: true });
  await expect
    .poll(async () => {
      const bounds = await send.boundingBox();
      return bounds ? bounds.y + bounds.height : Infinity;
    })
    .toBeLessThanOrEqual(221);
  await send.tap();
  await expect(
    page.locator("p.message-text").filter({ hasText: "Native klavye alanı" }),
  ).toHaveCount(1);
});

for (const mode of ["native", "overlaid"] as const) {
  test(`very short ${mode} viewport keeps multiline draft and 44px Send above safe insets`, async ({
    page,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "Very short phone viewport regression.");
    await page.setViewportSize({ width: 863, height: 390 });
    if (mode === "overlaid") {
      await page.addInitScript(() => {
        const viewport = new EventTarget();
        Object.assign(viewport, {
          height: innerHeight,
          offsetTop: 0,
          scale: 1,
        });
        Object.defineProperty(window, "visualViewport", {
          value: viewport,
          configurable: true,
        });
      });
    }
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
    await expect(composer).toBeVisible();
    const text = `Kısa ekran ${mode} ${Date.now()}\n${"Yatay klavyede uzun taslağın tamamı korunmalı. ".repeat(6)}\nSon satır`;
    await composer.fill(text);
    await composer.focus();
    if (mode === "native") {
      await page.setViewportSize({ width: 863, height: 122 });
    } else {
      await page.evaluate(() => {
        Object.assign(window.visualViewport!, { height: 122, offsetTop: 12 });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
    }
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty("--mola-safe-top", "20px");
      root.style.setProperty("--mola-safe-right", "24px");
      root.style.setProperty("--mola-safe-bottom", "34px");
      root.style.setProperty("--mola-safe-left", "24px");
    });
    const top = mode === "native" ? 0 : 12;
    const send = page.getByRole("button", {
      name: "Mesaj gönder",
      exact: true,
    });
    await expect
      .poll(async () => {
        const bounds = await send.boundingBox();
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(top + 122 - 34);
    const button = await send.boundingBox();
    const input = await composer.boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(44);
    expect(button!.y).toBeGreaterThanOrEqual(top + 20);
    expect(input!.height).toBeGreaterThanOrEqual(32);
    expect(input!.y).toBeGreaterThanOrEqual(top + 20);
    expect(input!.x).toBeGreaterThanOrEqual(24);
    expect(button!.x + button!.width).toBeLessThanOrEqual(839);
    await expect(composer).toHaveValue(text);
    expect(
      await composer.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    const directory = join(tmpdir(), "mola-mobile-qa");
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: join(directory, `${info.project.name}-short-${mode}.png`),
      animations: "disabled",
    });
    await send.tap();
    await expect(composer).toHaveValue("");
    await expect(
      page.locator("p.message-text").filter({ hasText: text.split("\n")[0] }),
    ).toHaveCount(1);
  });
}
