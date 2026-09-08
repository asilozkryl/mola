import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

function worker(
  clients: Array<{
    url: string;
    focused?: boolean;
    visibilityState?: string;
    postMessage: (value: unknown) => void;
    focus: () => Promise<void>;
  }>,
) {
  const handlers = new Map<string, (event: any) => void>();
  const opened: string[] = [];
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    {
      URL,
      self: {
        location: { origin: "https://mola.example" },
        addEventListener: (name: string, handler: (event: any) => void) =>
          handlers.set(name, handler),
        clients: {
          matchAll: async () => clients,
          openWindow: async (url: string) => {
            opened.push(url);
          },
        },
      },
    },
  );
  return {
    opened,
    async click(data: object) {
      let pending: Promise<unknown> | undefined;
      handlers.get("notificationclick")!({
        notification: { close() {}, data },
        waitUntil: (value: Promise<unknown>) => {
          pending = value;
        },
      });
      await pending;
    },
  };
}

test("notification click prefers a focused application tab and leaves admin pages untouched", async () => {
  const messages: string[] = [];
  const focused: string[] = [];
  const client = (url: string, name: string, active = false) => ({
    url,
    focused: active,
    postMessage: () => {
      messages.push(name);
    },
    focus: async () => {
      focused.push(name);
    },
  });
  const service = worker([
    client("https://mola.example/admin", "admin", true),
    client("https://mola.example/", "background"),
    client(
      "https://mola.example/?workspace=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      "active",
      true,
    ),
  ]);
  await service.click({
    url: "/?message=bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  });
  assert.deepEqual(messages, ["active"]);
  assert.deepEqual(focused, ["active"]);
  assert.deepEqual(service.opened, []);
});

test("test notification focuses the app without replacing its active conversation", async () => {
  let messages = 0;
  let focused = 0;
  const service = worker([
    {
      url: "https://mola.example/?profile=member",
      postMessage: () => {
        messages++;
      },
      focus: async () => {
        focused++;
      },
    },
  ]);
  await service.click({ url: "/", test: true });
  assert.equal(messages, 0);
  assert.equal(focused, 1);
  assert.deepEqual(service.opened, []);
});

test("closed or unrelated tabs fall back to a safe application window", async () => {
  const service = worker([
    {
      url: "https://mola.example/",
      postMessage: () => {},
      focus: async () => {
        throw new Error("closed");
      },
    },
  ]);
  await service.click({ url: "https://outside.example/?token=secret" });
  assert.deepEqual(service.opened, ["https://mola.example/"]);
  const unrelated = worker([
    {
      url: "https://mola.example/admin",
      postMessage: () => {
        assert.fail("must not navigate admin");
      },
      focus: async () => {},
    },
  ]);
  await unrelated.click({
    url: "/?message=------------------------------------",
  });
  assert.deepEqual(unrelated.opened, ["https://mola.example/"]);
});
