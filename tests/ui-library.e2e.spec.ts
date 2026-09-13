import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [390, 1440]) {
    test(`shared UI remains accessible in ${colorScheme} mode at ${width}px`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(
        page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
      ).toBeVisible();
      await expect(
        page.getByText("Her şey güncel", { exact: true }),
      ).toBeAttached();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        "system",
      );
      await expect
        .poll(() =>
          page
            .locator("html")
            .evaluate((element) => element.classList.contains("dark")),
        )
        .toBe(colorScheme === "dark");
      await page.evaluate(() => document.fonts.ready);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      await test
        .info()
        .attach("accessibility", {
          body: JSON.stringify(audit.violations),
          contentType: "application/json",
        });
      expect(audit.violations).toEqual([]);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/mola-${colorScheme}-${width}.png`,
        animations: "disabled",
      });
      expect(errors).toEqual([]);
    });
  }
}
