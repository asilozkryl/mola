import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Bootstrap, WorkspaceOrderState } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const password = "workspace-order-browser-test-password";
const headers = { Origin: origin };
const rail = (page: Page) => page.locator(".rail-workspaces");
const ids = (page: Page) =>
  rail(page)
    .locator("[data-workspace-id]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-workspace-id")),
    );
async function state(page: Page): Promise<WorkspaceOrderState> {
  const response = await page.request.get("/api/workspace-order");
  expect(response.status()).toBe(200);
  return response.json();
}
async function fixture(page: Page) {
  const email = `workspace-order-${randomUUID()}@example.invalid`;
  const registration = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Sıralama Sahibi",
      email,
      password,
      workspaceName: "Atlas Ekibi",
    },
  });
  expect(registration.status()).toBe(200);
  for (const name of ["Badem Tasarım", "Ceviz Stüdyo"]) {
    const created = await page.request.post("/api/workspaces", {
      headers,
      data: { name },
    });
    expect(created.status()).toBe(200);
  }
  const bootstrap = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  await page.goto("/");
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  await expect(rail(page).locator('[draggable="true"]')).toHaveCount(3);
  return { email, bootstrap, initial: (await state(page)).workspaceIds };
}

test("dragging workspace icons persists a personal order across reload and independent sessions without switching", async ({
  page,
  browser,
}) => {
  const { email, initial, bootstrap } = await fixture(page);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    expect(
      (
        await other.request.post("/api/auth/login", {
          headers,
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    await other.goto("/");
    await expect(
      other.getByText("Her şey güncel", { exact: true }),
    ).toBeVisible();
    const beforeOther = (await (
      await other.request.get("/api/auth/me")
    ).json()) as Bootstrap;
    const source = rail(page).locator(`[data-workspace-id="${initial[2]}"]`);
    const target = rail(page).locator(`[data-workspace-id="${initial[0]}"]`);
    await source.dragTo(target, { targetPosition: { x: 20, y: 2 } });
    const expected = [initial[2], initial[0], initial[1]];
    await expect.poll(() => ids(page)).toEqual(expected);
    await expect
      .poll(() => state(page).then((result) => result.workspaceIds))
      .toEqual(expected);
    await expect.poll(() => ids(other)).toEqual(expected);
    expect(
      ((await (await page.request.get("/api/auth/me")).json()) as Bootstrap)
        .workspace.id,
    ).toBe(bootstrap.workspace.id);
    expect(
      ((await (await other.request.get("/api/auth/me")).json()) as Bootstrap)
        .workspace.id,
    ).toBe(beforeOther.workspace.id);
    await page.reload();
    await expect.poll(() => ids(page)).toEqual(expected);
    const first = rail(page).locator(`[data-workspace-id="${initial[2]}"]`);
    await first.focus();
    await first.press("Alt+ArrowDown");
    await expect
      .poll(() => state(page).then((result) => result.workspaceIds))
      .toEqual([initial[0], initial[2], initial[1]]);
    await first.press("Shift+F10");
    const menu = page.getByRole("menu", {
      name: "Ceviz Stüdyo sıralama menüsü",
      exact: true,
    });
    await expect(menu).toBeVisible();
    await menu
      .getByRole("menuitem", { name: "Yukarı taşı", exact: true })
      .click();
    await expect
      .poll(() => state(page).then((result) => result.workspaceIds))
      .toEqual(expected);
  } finally {
    await otherContext.close();
  }
});

test("failed saves roll back the rail and stale revisions refresh without silently overwriting another order", async ({
  page,
}) => {
  const { initial } = await fixture(page);
  let failNext = true;
  await page.route("**/api/workspace-order", async (route) => {
    if (route.request().method() === "PUT" && failNext) {
      failNext = false;
      await route.abort("failed");
    } else await route.continue();
  });
  const last = rail(page).locator(`[data-workspace-id="${initial[2]}"]`);
  await last.focus();
  await last.press("Alt+ArrowUp");
  await expect(page.locator(".rail-order-error")).toBeVisible();
  await expect.poll(() => ids(page)).toEqual(initial);
  expect((await state(page)).workspaceIds).toEqual(initial);
  await page.unrouteAll({ behavior: "wait" });
  await last.press("Alt+ArrowUp");
  const saved = [initial[0], initial[2], initial[1]];
  await expect
    .poll(() => state(page).then((result) => result.workspaceIds))
    .toEqual(saved);
  await expect(page.locator(".rail-order-error")).toHaveCount(0);
  let recovering = false;
  let release!: () => void;
  let captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const recoveryStarted = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/workspace-order", async (route) => {
    if (route.request().method() === "PUT") {
      recovering = true;
      const body = route.request().postDataJSON();
      await route.continue({
        postData: JSON.stringify({ ...body, revision: 0 }),
      });
    } else if (recovering) {
      captured();
      await gate;
      await route.continue();
    } else await route.continue();
  });
  try {
    await last.press("Alt+ArrowUp");
    await recoveryStarted;
    await expect(page.locator(".rail-order-error")).toBeVisible();
    await expect(rail(page).locator('[draggable="true"]')).toHaveCount(0);
    await expect.poll(() => ids(page)).toEqual(saved);
    release();
    await expect(rail(page).locator('[draggable="true"]')).toHaveCount(3);
    expect((await state(page)).workspaceIds).toEqual(saved);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("workspace ordering remains accessible with touch buttons at 320px", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const { initial } = await fixture(page);
    await page
      .getByRole("button", { name: /^Çalışma alanını değiştir:/ })
      .tap();
    const dialog = page.getByRole("dialog", {
      name: "Çalışma alanların",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Sırayı düzenle", exact: true })
      .tap();
    await dialog
      .getByRole("button", {
        name: "Ceviz Stüdyo alanını yukarı taşı",
        exact: true,
      })
      .tap();
    await expect
      .poll(() => state(page).then((result) => result.workspaceIds))
      .toEqual([initial[0], initial[2], initial[1]]);
    await expect(
      dialog.getByRole("button", {
        name: "Ceviz Stüdyo alanını yukarı taşı",
        exact: true,
      }),
    ).toBeFocused();
    await expect(dialog.locator("[data-workspace-choice-id]")).toHaveCount(3);
    for (const button of await dialog
      .locator(".workspace-order-controls button")
      .all()) {
      const rect = (await button.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(320);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(720);
    }
    const audit = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.failureSummary),
      })),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Tamam", exact: true }).tap();
    await expect(
      dialog.getByRole("button", {
        name: "Badem Tasarım alanına geç",
        exact: true,
      }),
    ).toBeEnabled();
  } finally {
    await context.close();
  }
});
