import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  clearDesktopNotifications,
  readDesktopNotificationPreferences,
  saveDesktopNotificationPreferences,
  showDesktopNotification,
} from "../src/lib/desktopNotifications";

const workspaceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const messageId = (number: number) =>
  `bbbbbbbb-bbbb-4bbb-bbbb-${String(number).padStart(12, "0")}`;

class NativeNotification {
  static permission = "granted";
  static created: NativeNotification[] = [];
  onshow: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onclick: (() => void) | null = null;
  closed = false;
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    NativeNotification.created.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

class Sound extends EventTarget {
  static created: Sound[] = [];
  preload = "";
  volume = 1;
  paused = false;
  constructor(public src: string) {
    super();
    Sound.created.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {}
}

function desktop(t: TestContext) {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  const window = Object.assign(new EventTarget(), {
    Notification: NativeNotification,
    location: { origin: "https://mola.example" },
    focus() {},
    open() {},
  });
  const globals = {
    window,
    navigator: { userAgent: "Mola Electron/44.3.0" },
    location: window.location,
    localStorage,
    Notification: NativeNotification,
    Audio: Sound,
  };
  const originals = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  NativeNotification.created = [];
  Sound.created = [];
  t.mock.timers.enable({
    apis: ["setTimeout", "Date"],
    now: new Date("2030-01-01T00:00:00Z"),
  });
  t.after(() => {
    clearDesktopNotifications();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    t.mock.timers.reset();
  });
  saveDesktopNotificationPreferences("account-a", {
    enabled: true,
    sound: true,
  });
}

test("cancelled native delivery cannot play a late chime after notifications are re-enabled", async (t) => {
  desktop(t);
  const result = showDesktopNotification(
    "account-a",
    { workspaceId },
    { test: true },
  );
  const notification = NativeNotification.created[0];
  // Keep an already-queued OS callback, even if cleanup detaches the handler.
  const lateShow = notification.onshow!;
  saveDesktopNotificationPreferences("account-a", {
    enabled: false,
    sound: true,
  });
  assert.equal(await result, false);
  assert.equal(notification.closed, true);
  saveDesktopNotificationPreferences("account-a", {
    enabled: true,
    sound: true,
  });
  lateShow();
  assert.equal(Sound.created.length, 0);
});

test("timed-out native delivery rejects and cannot play a delayed chime", async (t) => {
  desktop(t);
  const result = showDesktopNotification(
    "account-a",
    { workspaceId },
    { test: true },
  );
  const notification = NativeNotification.created[0];
  const lateShow = notification.onshow!;
  const failed = assert.rejects(result, /doğrulanamadı/);
  t.mock.timers.tick(8000);
  await failed;
  assert.equal(notification.closed, true);
  lateShow();
  assert.equal(Sound.created.length, 0);
});

test("sound preference is rechecked at delivery and disabling sound stops playback", async (t) => {
  desktop(t);
  const silent = showDesktopNotification(
    "account-a",
    { workspaceId },
    { test: true },
  );
  saveDesktopNotificationPreferences("account-a", {
    enabled: true,
    sound: false,
  });
  NativeNotification.created[0].onshow!();
  assert.equal(await silent, true);
  assert.equal(Sound.created.length, 0);
  assert.equal(NativeNotification.created[0].options.silent, true);

  saveDesktopNotificationPreferences("account-a", {
    enabled: true,
    sound: true,
  });
  const audible = showDesktopNotification(
    "account-a",
    { workspaceId },
    { test: true },
  );
  NativeNotification.created[1].onshow!();
  assert.equal(await audible, true);
  assert.equal(Sound.created.length, 1);
  saveDesktopNotificationPreferences("account-a", {
    enabled: true,
    sound: false,
  });
  assert.equal(Sound.created[0].paused, true);
  assert.equal(Sound.created[0].src, "");
});

test("account opt-in is isolated and a pending old-account notification becomes inert", async (t) => {
  desktop(t);
  assert.equal(readDesktopNotificationPreferences("account-b").enabled, false);
  assert.equal(
    await showDesktopNotification("account-b", { workspaceId }, { test: true }),
    false,
  );
  assert.equal(NativeNotification.created.length, 0);
  let activeAccount = "account-a";
  const oldAccount = showDesktopNotification(
    "account-a",
    { workspaceId },
    {
      test: true,
      current: () => activeAccount === "account-a",
    },
  );
  activeAccount = "account-b";
  NativeNotification.created[0].onshow!();
  assert.equal(await oldAccount, false);
  assert.equal(NativeNotification.created[0].closed, true);
  assert.equal(Sound.created.length, 0);

  saveDesktopNotificationPreferences("account-b", {
    enabled: true,
    sound: false,
  });
  const currentAccount = showDesktopNotification(
    "account-b",
    { workspaceId },
    {
      test: true,
      current: () => activeAccount === "account-b",
    },
  );
  NativeNotification.created[1].onshow!();
  assert.equal(await currentAccount, true);
  assert.equal(Sound.created.length, 0);
  assert.equal(readDesktopNotificationPreferences("account-a").sound, true);
});

test("duplicate attention and rapid bursts coalesce while a later new message alerts", async (t) => {
  desktop(t);
  const target = (number: number) => ({
    workspaceId,
    messageId: messageId(number),
  });
  const first = showDesktopNotification("account-a", target(1));
  NativeNotification.created[0].onshow!();
  assert.equal(await first, true);
  Sound.created[0].dispatchEvent(new Event("ended"));
  assert.equal(await showDesktopNotification("account-a", target(1)), false);
  assert.equal(await showDesktopNotification("account-a", target(2)), false);
  t.mock.timers.tick(2000);
  assert.equal(await showDesktopNotification("account-a", target(2)), false);
  const later = showDesktopNotification("account-a", target(3));
  NativeNotification.created[1].onshow!();
  assert.equal(await later, true);
  assert.equal(NativeNotification.created.length, 2);
  assert.equal(Sound.created.length, 2);
});
