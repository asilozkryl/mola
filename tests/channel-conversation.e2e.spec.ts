import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Message } from "../shared/types";

const headers = { Origin: "http://127.0.0.1:5174" };

test("channel message groups keep separate reply and pin actions", async ({
  page,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Deniz Sohbet",
      email: `channel-layout-${randomUUID()}@example.invalid`,
      password: "channel-layout-browser-password-2026",
      workspaceName: "Sohbet Düzeni",
    },
  });
  expect(registration.status()).toBe(200);
  const data = (await registration.json()) as Bootstrap;
  const channel = data.channels.find((item) => item.name === "genel")!;
  const messages: Message[] = [];
  for (const content of [
    "İlk tasarım notu",
    "Bu nota bir ekleme",
    "Son bir ayrıntı",
  ]) {
    const response = await page.request.post(
      `/api/channels/${channel.id}/messages`,
      {
        headers,
        data: { content },
      },
    );
    expect(response.status()).toBe(201);
    messages.push(await response.json());
  }
  await page.goto("/");
  const timeline = page.locator(".channel-timeline");
  const article = (index: number) =>
    timeline.locator(`[data-message-id="${messages[index].id}"]`);
  await expect(article(0)).toHaveAttribute("data-grouped", "false");
  await expect(article(1)).toHaveAttribute("data-grouped", "true");
  await expect(article(2)).toHaveAttribute("data-grouped", "true");
  await expect(article(1).locator(".message-author-avatar")).toBeHidden();
  await expect(article(1).locator("time")).toHaveAttribute(
    "datetime",
    messages[1].createdAt,
  );
  expect((await article(1).boundingBox())!.height).toBeLessThan(
    (await article(0).boundingBox())!.height,
  );

  await article(1).hover();
  await expect(article(1).locator("time")).toHaveCSS("opacity", "1");
  await article(1)
    .getByRole("button", { name: "Mesajı yanıtla", exact: true })
    .click();
  await expect(
    page
      .locator(".thread-panel > .thread-messages")
      .getByText(messages[1].content, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
    .click();

  await article(1).hover();
  await article(1)
    .getByRole("button", { name: "Diğer mesaj işlemleri", exact: true })
    .click();
  await article(1)
    .getByRole("button", { name: "Kanala sabitle", exact: true })
    .click();
  await expect(article(1)).toHaveAttribute("data-grouped", "false");
  await expect(article(2)).toHaveAttribute("data-grouped", "false");
  await expect(article(1).locator(".message-author-avatar")).toBeVisible();

  await page
    .getByRole("button", { name: "#genel kanalının bilgileri", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Kanal hakkında", exact: true }),
  ).toBeVisible();
});
