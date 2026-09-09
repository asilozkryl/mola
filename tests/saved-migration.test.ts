import test from "node:test";
import assert from "node:assert/strict";
import {
  migrateSavedMessages,
  SavedMigrationError,
  savedMigrationIds,
} from "../src/lib/saved-migration";

const id = (index: number) =>
  `11111111-1111-4111-8111-${index.toString().padStart(12, "0")}`;
function fixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const stored = new Set<string>();
  const batches: string[][] = [];
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const options = {
    storage,
    userId: "user",
    workspaceId: "team",
    current: () => true,
    importBatch: async (ids: string[]) => {
      batches.push(ids);
      [...ids].reverse().forEach((id) => stored.add(id));
    },
    readIds: async () => [...stored],
  };
  return { values, stored, batches, options };
}

test("more than 500 oldest-first local records migrate in full with newest-first server order", async () => {
  const ids = Array.from({ length: 751 }, (_, index) => id(index));
  const raw = JSON.stringify(
    ids.map((id) => ({ id, content: "private cached text", attachments: [] })),
  );
  const f = fixture({ "mola:saved:user:team": raw });
  await migrateSavedMessages(f.options);
  assert.deepEqual(
    f.batches.map((batch) => batch.length),
    [500, 251],
  );
  assert.deepEqual([...f.stored].reverse(), [...ids].reverse());
  assert.equal(f.values.has("mola:saved:user:team"), false);
  assert.equal(
    f.batches.flat().every((value) => typeof value === "string"),
    true,
  );
});

test("partial import failure preserves the local source and retry is idempotent", async () => {
  const ids = Array.from({ length: 601 }, (_, index) => id(index));
  const raw = JSON.stringify(ids);
  const f = fixture({ "mola:saved:user:team": raw });
  let calls = 0;
  await assert.rejects(
    migrateSavedMessages({
      ...f.options,
      importBatch: async (batch) => {
        if (++calls === 2) throw new Error("offline");
        await f.options.importBatch(batch);
      },
    }),
    SavedMigrationError,
  );
  assert.equal(f.values.get("mola:saved:user:team"), raw);
  assert.equal(f.stored.size, 500);
  await migrateSavedMessages(f.options);
  assert.equal(f.stored.size, 601);
  assert.deepEqual([...f.stored].reverse(), [...ids].reverse());
  assert.equal(f.values.has("mola:saved:user:team"), false);
});

test("legacy account records survive workspace migration and removed bookmarks are not reimported", async () => {
  const local = JSON.stringify([{ id: id(1) }, { id: id(2) }]);
  const f = fixture({ "mola:saved:user": local });
  await migrateSavedMessages({
    ...f.options,
    importBatch: async (batch) => {
      batch
        .filter((value) => value === id(1))
        .forEach((value) => f.stored.add(value));
    },
  });
  assert.equal(f.values.get("mola:saved:user"), local);
  assert.deepEqual(JSON.parse(f.values.get("mola:saved-imported:user:team")!), [
    id(1),
  ]);
  f.stored.clear();
  const retried: string[] = [];
  await migrateSavedMessages({
    ...f.options,
    importBatch: async (batch) => {
      retried.push(...batch);
    },
  });
  assert.deepEqual(
    retried,
    [id(2)],
    "the bookmark removed after a successful migration stays removed",
  );
  await migrateSavedMessages({
    ...f.options,
    workspaceId: "another-team",
    importBatch: async (batch) => {
      batch
        .filter((value) => value === id(2))
        .forEach((value) => f.stored.add(value));
    },
  });
  assert.equal(f.stored.has(id(2)), true);
  assert.equal(f.values.get("mola:saved:user"), local);
});

test("scope changes and concurrent local writes never delete an unacknowledged source", async () => {
  const raw = JSON.stringify([id(1)]);
  const f = fixture({ "mola:saved:user:team": raw });
  let current = true;
  assert.equal(
    await migrateSavedMessages({
      ...f.options,
      current: () => current,
      importBatch: async () => {
        current = false;
      },
    }),
    null,
  );
  assert.equal(f.values.get("mola:saved:user:team"), raw);
  const newer = JSON.stringify([id(1), id(2)]);
  await migrateSavedMessages({
    ...f.options,
    importBatch: async (batch) => {
      await f.options.importBatch(batch);
      f.values.set("mola:saved:user:team", newer);
    },
  });
  assert.equal(f.values.get("mola:saved:user:team"), newer);
});

test("ID read failures are distinct from migration errors and corrupt local data is preserved", async () => {
  const f = fixture();
  const offline = new Error("saved IDs unavailable");
  await assert.rejects(
    migrateSavedMessages({
      ...f.options,
      readIds: async () => {
        throw offline;
      },
    }),
    (error) => error === offline && !(error instanceof SavedMigrationError),
  );
  f.values.set("mola:saved:user:team", "broken JSON");
  await assert.rejects(migrateSavedMessages(f.options), SavedMigrationError);
  assert.equal(f.values.get("mola:saved:user:team"), "broken JSON");
  assert.deepEqual(
    savedMigrationIds(
      JSON.stringify([
        id(1),
        { id: id(1), content: "ignored" },
        null,
        8,
        "not-an-id",
      ]),
    ),
    [id(1)],
  );
});

test("an imported batch remains blocked until its final ID verification succeeds", async () => {
  const raw = JSON.stringify([id(1)]);
  const f = fixture({ "mola:saved:user:team": raw });
  await assert.rejects(
    migrateSavedMessages({
      ...f.options,
      readIds: async () => {
        throw new Error("verification failed");
      },
    }),
    SavedMigrationError,
  );
  assert.equal(f.stored.has(id(1)), true);
  assert.equal(f.values.get("mola:saved:user:team"), raw);
  await migrateSavedMessages(f.options);
  assert.equal(f.values.has("mola:saved:user:team"), false);
  f.stored.delete(id(1));
  await migrateSavedMessages(f.options);
  assert.equal(
    f.stored.size,
    0,
    "removal after a complete migration stays removed",
  );
});
