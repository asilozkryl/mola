import assert from "node:assert/strict";
import test from "node:test";
import { callDockPosition } from "../src/lib/floating-call-dock";

const size = { width: 320, height: 60 };
const viewport = { x: 12, y: 12, width: 1176, height: 776 };
const composer = { x: 290, y: 650, width: 880, height: 130 };

test("a new dock starts on the right above the composer instead of covering it", () => {
  assert.deepEqual(callDockPosition(null, size, viewport, [composer]), {
    x: 868,
    y: 578,
  });
  assert.deepEqual(callDockPosition(null, size, viewport), {
    x: 868,
    y: 728,
  });
});

test("dragging is bounded on every edge and cannot cover an intersecting composer", () => {
  assert.deepEqual(callDockPosition({ x: -80, y: -40 }, size, viewport), {
    x: 12,
    y: 12,
  });
  assert.deepEqual(callDockPosition({ x: 1500, y: 1000 }, size, viewport), {
    x: 868,
    y: 728,
  });
  assert.deepEqual(
    callDockPosition({ x: 700, y: 700 }, size, viewport, [composer]),
    { x: 700, y: 578 },
  );
});

test("visible keyboard bounds and composer growth move the dock without changing its preferred point", () => {
  const preferred = { x: 220, y: 560 };
  const phone = { x: 12, y: 12, width: 366, height: 396 };
  const input = { x: 8, y: 290, width: 374, height: 118 };
  assert.deepEqual(callDockPosition(preferred, size, phone, [input]), {
    x: 58,
    y: 218,
  });
  assert.deepEqual(preferred, { x: 220, y: 560 });
  assert.deepEqual(
    callDockPosition(preferred, size, phone, [{ ...input, y: 260 }]),
    { x: 58, y: 188 },
  );
});

test("a side composer only limits positions over that composer and offscreen forms do not interfere", () => {
  const sideComposer = { x: 900, y: 550, width: 280, height: 230 };
  assert.deepEqual(
    callDockPosition({ x: 12, y: 700 }, size, viewport, [sideComposer]),
    { x: 12, y: 700 },
  );
  assert.deepEqual(
    callDockPosition(null, size, viewport, [
      { x: 900, y: -500, width: 280, height: 100 },
    ]),
    { x: 868, y: 728 },
  );
});

test("very small visible viewports keep the handle at the safe top edge", () => {
  assert.deepEqual(
    callDockPosition(null, size, { x: 10, y: 14, width: 280, height: 45 }),
    { x: 10, y: 14 },
  );
});
