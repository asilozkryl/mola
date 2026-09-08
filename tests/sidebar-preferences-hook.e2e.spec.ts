import { test, expect, type Page } from "@playwright/test";
import type { SidebarPreferencesState } from "../shared/sidebar";

const initial = (
  userId = "user-a",
  workspaceId = "workspace-a",
  revision = 0,
): SidebarPreferencesState => ({
  userId,
  workspaceId,
  revision,
  preferences: {
    textOrder: [`${workspaceId}-one`, `${workspaceId}-two`],
    voiceOrder: [],
    favoriteIds: [],
    collapsedSections: [],
  },
});
const read = async (page: Page) =>
  JSON.parse(await page.getByTestId("state").innerText());

async function harness(page: Page) {
  // Use Vite's current dependency URLs so the real hook and renderer share React.
  const hook = await (
    await page.request.get("/src/lib/useSidebarPreferences.ts")
  ).text();
  const main = await (await page.request.get("/src/main.tsx")).text();
  const reactUrl = hook.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)?.[1];
  const domUrl = main.match(
    /from\s+["']([^"']*\/react-dom_client\.js[^"']*)["']/,
  )?.[1];
  expect(reactUrl).toBeTruthy();
  expect(domUrl).toBeTruthy();
  await page.route("**/sidebar-hook-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><div id="root"></div><script type="module">
      import React from ${JSON.stringify(reactUrl)};
      import ReactDOM from ${JSON.stringify(domUrl)};
      import { useSidebarPreferences } from '/src/lib/useSidebarPreferences.ts';
      const listeners = new Map();
      const socket = {
        on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return this; },
        off(name, fn) { listeners.get(name)?.delete(fn); return this; }
      };
      window.addEventListener('test:socket', e => listeners.get(e.detail.name)?.forEach(fn => fn(e.detail.value)));
      function Harness() {
        const [workspaceId, workspace] = React.useState('workspace-a');
        const [userId, user] = React.useState('user-a');
        const [revoked, revoke] = React.useState(false);
        const channels = [1, 2].filter(n => !(revoked && n === 1)).map(n => ({id: workspaceId + (n === 1 ? '-one' : '-two'), name: 'Channel ' + n, kind: 'text', description: ''}));
        const sidebar = useSidebarPreferences({ userId, workspaceId, channels, socket });
        return React.createElement('div', {},
          React.createElement('pre', {'data-testid':'state'}, JSON.stringify({userId, workspaceId, ...sidebar})),
          React.createElement('button', {onClick:()=>sidebar.toggleFavorite(workspaceId+'-one'), disabled:sidebar.loading||sidebar.saving}, 'Favorite'),
          React.createElement('button', {onClick:()=>workspace('workspace-b')}, 'Other workspace'),
          React.createElement('button', {onClick:()=>user('user-b')}, 'Other account'),
          React.createElement('button', {onClick:()=>revoke(true)}, 'Revoke channel'),
          React.createElement('button', {onClick:()=>sidebar.reload()}, 'Reload')
        );
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
    </script></body></html>`,
    }),
  );
  await page.route("**/api/sidebar-conversations", (route) => {
    const headers = route.request().headers();
    return route.fulfill({
      json: {
        userId: headers["x-user-id"],
        workspaceId: headers["x-workspace-id"],
        conversations: [],
      },
    });
  });
  await page.goto("/sidebar-hook-harness");
  await expect(page.getByTestId("state")).toBeVisible();
}

test("sidebar hook shows optimistic favorites and rolls back a failed save", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sidebar-preferences", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: initial() });
    await pending;
    await route.fulfill({
      status: 503,
      json: { error: "Düzen kaydedilemedi." },
    });
  });
  await harness(page);
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect
    .poll(async () => (await read(page)).preferences.favoriteIds)
    .toEqual(["workspace-a-one"]);
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeDisabled();
  release();
  await expect.poll(async () => (await read(page)).saving).toBe(false);
  expect((await read(page)).preferences.favoriteIds).toEqual([]);
  expect((await read(page)).error).toBe("Düzen kaydedilemedi.");
});

test("sidebar hook ignores late mutations and socket state from another workspace or account", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sidebar-preferences", async (route) => {
    const headers = route.request().headers();
    const state = initial(headers["x-user-id"], headers["x-workspace-id"]);
    if (route.request().method() === "GET")
      return route.fulfill({ json: state });
    const input = route.request().postDataJSON();
    await pending;
    await route
      .fulfill({
        json: { ...state, revision: 1, preferences: input.preferences },
      })
      .catch(() => {});
  });
  await harness(page);
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect.poll(async () => (await read(page)).saving).toBe(true);
  await page
    .getByRole("button", { name: "Other workspace", exact: true })
    .click();
  await expect
    .poll(async () => (await read(page)).workspaceId)
    .toBe("workspace-b");
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeEnabled();
  release();
  const old = initial("user-a", "workspace-a", 20);
  old.preferences.favoriteIds = ["workspace-a-one"];
  await page.evaluate(
    (value) =>
      window.dispatchEvent(
        new CustomEvent("test:socket", {
          detail: { name: "sidebar:updated", value },
        }),
      ),
    old,
  );
  expect((await read(page)).preferences.favoriteIds).toEqual([]);
  await page
    .getByRole("button", { name: "Other account", exact: true })
    .click();
  await expect.poll(async () => (await read(page)).userId).toBe("user-b");
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeEnabled();
  const otherAccount = initial("user-a", "workspace-b", 30);
  otherAccount.preferences.favoriteIds = ["workspace-b-one"];
  await page.evaluate(
    (value) =>
      window.dispatchEvent(
        new CustomEvent("test:socket", {
          detail: { name: "sidebar:updated", value },
        }),
      ),
    otherAccount,
  );
  expect((await read(page)).preferences.favoriteIds).toEqual([]);
});

test("sidebar hook retains newer socket revisions while an older save is pending and removes revoked channels", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sidebar-preferences", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: initial() });
    const input = route.request().postDataJSON();
    await pending;
    await route.fulfill({
      json: { ...initial(), revision: 1, preferences: input.preferences },
    });
  });
  await harness(page);
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Favorite", exact: true }).click();
  const remote = initial("user-a", "workspace-a", 2);
  remote.preferences.favoriteIds = ["workspace-a-two", "workspace-a-one"];
  remote.preferences.width = 315;
  await page.evaluate(
    (value) =>
      window.dispatchEvent(
        new CustomEvent("test:socket", {
          detail: { name: "sidebar:updated", value },
        }),
      ),
    remote,
  );
  release();
  await expect
    .poll(async () => (await read(page)).preferences.favoriteIds)
    .toEqual(["workspace-a-two", "workspace-a-one"]);
  expect((await read(page)).preferences.width).toBe(315);
  await page
    .getByRole("button", { name: "Revoke channel", exact: true })
    .click();
  await expect
    .poll(async () => (await read(page)).preferences.favoriteIds)
    .toEqual(["workspace-a-two"]);
  expect(
    (await read(page)).orderedTextChannels.map(
      (channel: { id: string }) => channel.id,
    ),
  ).toEqual(["workspace-a-two"]);
});

test("sidebar hook reloads authoritative preferences after a revision conflict", async ({
  page,
}) => {
  let state = initial();
  await page.route("**/api/sidebar-preferences", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: state });
    state = initial("user-a", "workspace-a", 4);
    state.preferences.favoriteIds = ["workspace-a-two"];
    return route.fulfill({
      status: 409,
      json: {
        code: "SIDEBAR_REVISION_CONFLICT",
        error: "Düzen başka bir sekmede değişti.",
      },
    });
  });
  await harness(page);
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect
    .poll(async () => (await read(page)).preferences.favoriteIds)
    .toEqual(["workspace-a-two"]);
  expect((await read(page)).error).toBe("Düzen başka bir sekmede değişti.");
  await expect(
    page.getByRole("button", { name: "Favorite", exact: true }),
  ).toBeEnabled();
});

test("sidebar hook clears a loading error after an explicit successful retry", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/api/sidebar-preferences", (route) => {
    if (unavailable)
      return route.fulfill({
        status: 503,
        json: { error: "Kenar çubuğu şu anda yüklenemedi." },
      });
    if (route.request().method() === "GET")
      return route.fulfill({ json: initial() });
    const input = route.request().postDataJSON();
    return route.fulfill({
      json: { ...initial(), revision: 1, preferences: input.preferences },
    });
  });
  await harness(page);
  await expect
    .poll(async () => (await read(page)).error)
    .toBe("Kenar çubuğu şu anda yüklenemedi.");
  unavailable = false;
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect.poll(async () => (await read(page)).error).toBe("");
  await page.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect
    .poll(async () => (await read(page)).preferences.favoriteIds)
    .toEqual(["workspace-a-one"]);
  await expect.poll(async () => (await read(page)).saving).toBe(false);
});
