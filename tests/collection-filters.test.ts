import assert from "node:assert/strict";
import test from "node:test";
import { collectionDateRange } from "../src/lib/collection-filters";

test("inclusive calendar end dates include the complete last local day", () => {
  const range = collectionDateRange("2024-02-28", "2024-02-29");
  assert.equal(range.error, "");
  assert.equal(range.startAt, new Date(2024, 1, 28).toISOString());
  assert.equal(range.endBefore, new Date(2024, 2, 1).toISOString());
  assert.deepEqual(collectionDateRange("", ""), { error: "" });
  assert.deepEqual(collectionDateRange("2026-09-09", ""), {
    startAt: new Date(2026, 8, 9).toISOString(),
    error: "",
  });
});

test("invalid or reversed dates do not produce API bounds", () => {
  for (const [start, end] of [
    ["2026-02-29", ""],
    ["", "2026-13-01"],
    ["2026-09-10", "2026-09-09"],
    ["not-a-date", ""],
  ]) {
    const range = collectionDateRange(start, end);
    assert.ok(range.error);
    assert.equal(range.startAt, undefined);
    assert.equal(range.endBefore, undefined);
  }
});

test("a selected day spanning DST uses the next local midnight instead of adding 24 hours", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const spring = collectionDateRange("2026-03-08", "2026-03-08");
    assert.equal(spring.startAt, "2026-03-08T05:00:00.000Z");
    assert.equal(spring.endBefore, "2026-03-09T04:00:00.000Z");
    const autumn = collectionDateRange("2026-11-01", "2026-11-01");
    assert.equal(autumn.startAt, "2026-11-01T04:00:00.000Z");
    assert.equal(autumn.endBefore, "2026-11-02T05:00:00.000Z");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
