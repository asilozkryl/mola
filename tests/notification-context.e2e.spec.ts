import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap } from "../shared/types";

const headers = { Origin: "http://127.0.0.1:5174" };

test("a channel preference dialog closes across a session workspace switch and stays closed on return", async ({
  page,
}) => {
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Bildirim Bağlamı",
      email: `notification-context-${randomUUID()}@example.invalid`,
      password: "notification-context-test-password",
      workspaceName: "İlk Bildirim Alanı",
    },
  });
  expect(registered.status()).toBe(200);
  const home = (await registered.json()) as Bootstrap;
  const created = await page.request.post("/api/workspaces", {
    headers,
    data: { name: "İkinci Bildirim Alanı" },
  });
  expect(created.status()).toBe(200);
  const other = (await created.json()) as Bootstrap;
  await page.goto(`/?workspace=${home.workspace.id}`);
  const workspace = page.getByRole("button", {
    name: "Çalışma alanı menüsü",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Kanal bildirimleri",
    exact: true,
  });
  const open = async () => {
    await page
      .getByRole("button", { name: "genel kanal işlemleri", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Bildirim tercihleri", exact: true })
      .click();
    await expect(
      dialog.getByRole("combobox", {
        name: "Bu kanaldaki bildirimler",
        exact: true,
      }),
    ).toBeEnabled();
  };
  await expect(workspace).toContainText(home.workspace.name);
  await expect(page.locator(".channel-tab-end")).toHaveAttribute(
    "data-connected",
    "true",
  );
  await open();
  await dialog
    .getByRole("combobox", { name: "Bu kanaldaki bildirimler", exact: true })
    .selectOption("off");
  const channel = home.channels.find((channel) => channel.name === "genel")!;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `/api/channels/${channel.id}/notification-settings`,
            )
          ).json()
        ).mode,
    )
    .toBe("off");
  for (const target of [other, home]) {
    const switched = await page.request.post(
      `/api/workspaces/${target.workspace.id}/switch`,
      { headers },
    );
    expect(switched.status()).toBe(200);
    await expect(workspace).toContainText(target.workspace.name);
    await expect(page.locator(".channel-tab-end")).toHaveAttribute(
      "data-connected",
      "true",
    );
    await expect(dialog).toHaveCount(0);
  }
  await open();
  await expect(
    dialog.getByRole("combobox", {
      name: "Bu kanaldaki bildirimler",
      exact: true,
    }),
  ).toHaveValue("off");
});
