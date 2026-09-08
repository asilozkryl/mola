import assert from "node:assert/strict";
import { test } from "node:test";
import { createECDH } from "node:crypto";
import {
  pushConfigured,
  pushKeyMatches,
  type PushPreferences,
} from "../src/lib/pushSubscription";

function preferences() {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  return {
    pushEnabled: true,
    publicKey: curve.getPublicKey().toString("base64url"),
    userId: "user",
    sessionBinding: "session",
  } satisfies PushPreferences;
}

test("client accepts an available push key and rejects absent or malformed configuration", () => {
  const configured = preferences();
  assert.equal(pushConfigured(configured), true);
  assert.equal(pushConfigured(null), false);
  assert.equal(
    pushConfigured({ ...configured, publicKey: "not a key" }),
    false,
  );
  assert.equal(
    pushConfigured({
      ...configured,
      publicKey: Buffer.alloc(65).toString("base64url"),
    }),
    false,
  );
});

test("an existing browser subscription must use the current push key", () => {
  const current = preferences();
  const previous = preferences();
  const subscription = (key: string | null) =>
    ({
      options: {
        applicationServerKey: key
          ? Uint8Array.from(Buffer.from(key, "base64url")).buffer
          : null,
      },
    }) as PushSubscription;
  assert.equal(pushKeyMatches(subscription(current.publicKey), current), true);
  assert.equal(
    pushKeyMatches(subscription(previous.publicKey), current),
    false,
  );
  // Some browser implementations do not expose the key for an existing endpoint.
  assert.equal(pushKeyMatches(subscription(null), current), true);
});
