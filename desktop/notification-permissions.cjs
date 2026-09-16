const { open, writeFile, rename, mkdir } = require('node:fs/promises');
const { dirname } = require('node:path');
const { normalizeServerUrl } = require('./policy.cjs');

const maxBytes = 64 * 1024;
const maxOrigins = 64;
const maxOriginLength = 512;

async function readPermissions(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    // Read only a bounded buffer even if a malformed file grows after opening.
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return new Map();
    const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (value?.version !== 1 || !Array.isArray(value.origins) || value.origins.length > maxOrigins) return new Map();
    const result = new Map();
    for (const entry of value.origins) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[1] !== 'boolean') return new Map();
      const origin = normalizeServerUrl(entry[0]);
      if (origin !== entry[0] || origin.length > maxOriginLength || result.has(origin)) return new Map();
      result.set(origin, entry[1]);
    }
    return result;
  } catch {
    // Corrupt or inaccessible local data never silently restores permission.
    return new Map();
  } finally { await handle?.close(); }
}

async function createNotificationPermissionStore(file) {
  let permissions = await readPermissions(file);
  let pending = Promise.resolve();
  return {
    get(value) {
      try { return permissions.get(normalizeServerUrl(value)); }
      catch { return undefined; }
    },
    set(value, allowed) {
      const operation = pending.then(async () => {
        const origin = normalizeServerUrl(value);
        if (origin.length > maxOriginLength) throw new Error('Sunucu adresi çok uzun.');
        if (typeof allowed !== 'boolean') throw new Error('Geçersiz bildirim izni.');
        const next = new Map(permissions);
        next.delete(origin);
        next.set(origin, allowed);
        while (next.size > maxOrigins) next.delete(next.keys().next().value);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, origins: [...next] }), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        permissions = next;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}

module.exports = { createNotificationPermissionStore };
