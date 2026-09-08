import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Message } from "../shared/types";

const headers = { Origin: "http://127.0.0.1:5174" };

async function fixture(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & { reactionFeedback: string[] };
    state.reactionFeedback = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this instanceof HTMLButtonElement && this.dataset.reactionEmoji) {
        state.reactionFeedback.push(this.dataset.reactionEmoji);
      }
      return animate.apply(this, args);
    };
  });
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Deniz Akış",
      email: `feedback-${randomUUID()}@example.invalid`,
      password: "message-feedback-password-2026",
      workspaceName: "Akış Tasarımı",
    },
  });
  expect(registered.status()).toBe(200);
  const data = (await registered.json()) as Bootstrap;
  const channel = data.channels.find((entry) => entry.name === "genel")!;
  const sent = await page.request.post(`/api/channels/${channel.id}/messages`, {
    headers,
    data: { content: "Ekibin tasarım notu" },
  });
  expect(sent.status()).toBe(201);
  const message = (await sent.json()) as Message;
  const reacted = await page.request.post(
    `/api/messages/${message.id}/reactions`,
    { headers, data: { emoji: "💚" } },
  );
  expect(reacted.ok()).toBe(true);
  await page.goto("/");
  const article = page.locator(`article[data-message-id="${message.id}"]`);
  await expect(
    article.getByRole("button", { name: "💚 tepkisi, 1 kişi", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  return article;
}

async function feedback(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { reactionFeedback: string[] })
        .reactionFeedback,
  );
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`reaction feedback respects ${reducedMotion} and leaves loaded history still`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const article = await fixture(page);
    expect(await feedback(page)).toEqual([]);
    await expect(article).not.toHaveAttribute("data-fresh", "true");
    await article.hover();
    await article
      .locator(".message-actions")
      .getByRole("button", { name: "Tepki ekle", exact: true })
      .click();
    await article
      .getByRole("button", { name: "👍 tepkisi ekle", exact: true })
      .click();
    await expect(
      article.getByRole("button", { name: "👍 tepkisi, 1 kişi", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => feedback(page))
      .toEqual(reducedMotion === "reduce" ? [] : ["👍"]);

    // Reloading existing reactions must not replay live feedback.
    await page.reload();
    await expect(
      article.getByRole("button", { name: "👍 tepkisi, 1 kişi", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await feedback(page)).toEqual([]);
    await expect(article).not.toHaveAttribute("data-fresh", "true");
  });
}
