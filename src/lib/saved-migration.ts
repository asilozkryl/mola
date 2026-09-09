type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class SavedMigrationError extends Error {}

function storageAction<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw new SavedMigrationError(
      error instanceof Error ? error.message : "Yerel kayıtlar okunamadı.",
    );
  }
}

export function savedMigrationIds(raw: string | null): string[] {
  if (!raw) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values))
    throw new Error("Eski kayıtların biçimi okunamadı.");
  return [
    ...new Set(
      values.flatMap((value) => {
        const id = typeof value === "string" ? value : value?.id;
        return typeof id === "string" && uuid.test(id)
          ? [id.toLowerCase()]
          : [];
      }),
    ),
  ];
}

/** Keep the legacy account key: it can contain records from other workspaces. */
export async function migrateSavedMessages({
  storage,
  userId,
  workspaceId,
  importBatch,
  readIds,
  current,
}: {
  storage: StorageAccess;
  userId: string;
  workspaceId: string;
  importBatch: (ids: string[]) => Promise<unknown>;
  readIds: () => Promise<string[]>;
  current: () => boolean;
}) {
  const key = `mola:saved:${userId}:${workspaceId}`;
  const legacyKey = `mola:saved:${userId}`;
  const markerKey = `mola:saved-imported:${userId}:${workspaceId}`;
  const raw = storageAction(() => storage.getItem(key));
  // The old client appended each new bookmark, so local arrays are oldest first.
  const legacy = storageAction(() =>
    savedMigrationIds(storage.getItem(legacyKey)),
  ).reverse();
  const marked = storageAction(() =>
    savedMigrationIds(storage.getItem(markerKey)),
  );
  const completed = new Set(marked);
  const pending = [
    ...new Set([
      ...storageAction(() => savedMigrationIds(raw)).reverse(),
      ...legacy.filter((id) => !completed.has(id)),
    ]),
  ];
  // Each batch is newest first; older batches must be inserted before newer ones.
  for (let end = pending.length; end > 0; end -= 500) {
    if (!current()) return null;
    try {
      await importBatch(pending.slice(Math.max(0, end - 500), end));
    } catch (error) {
      throw new SavedMigrationError(
        error instanceof Error ? error.message : "Eski kayıtlar aktarılamadı.",
      );
    }
  }
  if (!current()) return null;
  let ids: string[];
  try {
    ids = await readIds();
  } catch (error) {
    if (pending.length)
      throw new SavedMigrationError(
        error instanceof Error ? error.message : "Aktarım doğrulanamadı.",
      );
    throw error;
  }
  if (!current()) return null;
  const confirmed = new Set(ids);
  const importedLegacy = legacy.filter((id) => confirmed.has(id));
  if (importedLegacy.length)
    storageAction(() =>
      storage.setItem(
        markerKey,
        JSON.stringify([...new Set([...marked, ...importedLegacy])]),
      ),
    );
  // A concurrent tab may have written more local records while requests ran.
  storageAction(() => {
    if (raw !== null && storage.getItem(key) === raw) storage.removeItem(key);
  });
  return ids;
}
