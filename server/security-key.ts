import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Shared master key; each feature must derive its own key with a unique HKDF context. */
export function loadAccountSecurityKey(
  dataDir: string,
  encryptionKey?: string,
): Buffer {
  const configured = encryptionKey || process.env.MAIL_ENCRYPTION_KEY;
  if (configured) {
    const key = /^[a-f0-9]{64}$/i.test(configured)
      ? Buffer.from(configured, "hex")
      : Buffer.from(configured, "base64");
    if (key.length !== 32)
      throw new Error(
        "Account security encryption key must contain exactly 32 bytes.",
      );
    return key;
  }
  mkdirSync(dataDir, { recursive: true });
  const keyPath = join(dataDir, ".account-security-key");
  if (!existsSync(keyPath)) {
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!existsSync(keyPath)) throw error;
    }
  }
  const key = readFileSync(keyPath);
  if (key.length !== 32)
    throw new Error(
      "Account security key is invalid. Restore the original key.",
    );
  return key;
}
