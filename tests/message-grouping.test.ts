import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "../shared/types";
import { shouldGroupMessage } from "../src/lib/messageGrouping";

const message = (overrides: Partial<Message> = {}): Message => ({
  id: "message",
  channelId: "channel",
  userId: "author",
  content: "A message",
  createdAt: "2026-09-14T12:00:00.000Z",
  replyCount: 0,
  reactions: [],
  attachments: [],
  pinned: false,
  ...overrides,
});

test("the first visible message starts a group", () => {
  assert.equal(shouldGroupMessage(undefined, message()), false);
});

test("consecutive messages include equal timestamps and the five-minute boundary", () => {
  const previous = message();
  for (const createdAt of [
    "2026-09-14T12:00:00.000Z",
    "2026-09-14T12:02:30.000Z",
    "2026-09-14T12:05:00.000Z",
  ]) {
    assert.equal(
      shouldGroupMessage(previous, message({ id: "next", createdAt })),
      true,
      createdAt,
    );
  }
});

test("older messages and gaps beyond five minutes start a group", () => {
  for (const createdAt of [
    "2026-09-14T11:59:59.999Z",
    "2026-09-14T12:05:00.001Z",
  ]) {
    assert.equal(
      shouldGroupMessage(message(), message({ createdAt })),
      false,
      createdAt,
    );
  }
});

test("changing the author, channel or reply parent starts a group", () => {
  for (const change of [
    { userId: "another-author" },
    { channelId: "another-channel" },
    { parentId: "thread" },
  ]) {
    assert.equal(shouldGroupMessage(message(), message(change)), false);
    assert.equal(shouldGroupMessage(message(change), message()), false);
  }
  assert.equal(
    shouldGroupMessage(
      message({ parentId: "thread-a" }),
      message({ parentId: "thread-b" }),
    ),
    false,
  );
  assert.equal(
    shouldGroupMessage(
      message({ parentId: "thread-a" }),
      message({ parentId: "thread-a" }),
    ),
    true,
  );
});

test("pinned messages break grouping on either side", () => {
  assert.equal(shouldGroupMessage(message({ pinned: true }), message()), false);
  assert.equal(shouldGroupMessage(message(), message({ pinned: true })), false);
});

test("calendar boundaries use the viewer's local date rather than the UTC date", () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = "Europe/Istanbul";
    assert.equal(
      shouldGroupMessage(
        message({ createdAt: "2026-09-14T20:59:00.000Z" }),
        message({ createdAt: "2026-09-14T21:01:00.000Z" }),
      ),
      false,
      "23:59 and 00:01 fall on different local days",
    );
    assert.equal(
      shouldGroupMessage(
        message({ createdAt: "2026-09-14T23:59:00.000Z" }),
        message({ createdAt: "2026-09-15T00:01:00.000Z" }),
      ),
      true,
      "02:59 and 03:01 belong to the same local day",
    );
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("invalid timestamps cannot join a group", () => {
  for (const createdAt of ["", "invalid-date", "+999999-01-01T00:00:00Z"]) {
    const invalid = message({ createdAt });
    assert.equal(shouldGroupMessage(invalid, message()), false);
    assert.equal(shouldGroupMessage(message(), invalid), false);
    assert.equal(shouldGroupMessage(invalid, invalid), false);
  }
});

test("editing a message does not change its grouping by creation time", () => {
  assert.equal(
    shouldGroupMessage(
      message({ editedAt: "2026-09-15T12:00:00.000Z" }),
      message({ editedAt: "2026-09-16T12:00:00.000Z" }),
    ),
    true,
  );
});
