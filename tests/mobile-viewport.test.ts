import assert from "node:assert/strict";
import { test } from "node:test";
import { mobileViewportMetrics } from "../src/lib/mobileViewport";

test("the visible viewport keeps a focused composer above a phone keyboard", () => {
  assert.deepEqual(
    mobileViewportMetrics({
      mobile: true,
      layoutHeight: 844,
      visualHeight: 460,
      visualOffsetTop: 35,
      scale: 1,
      focused: true,
    }),
    { height: 460, top: 35, keyboard: true },
  );
});

test("short landscape screens do not inherit a desktop minimum height", () => {
  assert.deepEqual(
    mobileViewportMetrics({
      mobile: true,
      layoutHeight: 390,
      visualHeight: 220,
      focused: true,
    }),
    { height: 220, top: 0, keyboard: true },
  );
});

test("browser chrome and an unfocused short viewport do not become keyboard mode", () => {
  assert.deepEqual(
    mobileViewportMetrics({
      mobile: true,
      layoutHeight: 844,
      visualHeight: 800,
      focused: true,
    }),
    { height: 800, top: 0, keyboard: false },
  );
  assert.deepEqual(
    mobileViewportMetrics({
      mobile: true,
      layoutHeight: 844,
      visualHeight: 460,
      focused: false,
    }),
    { height: 460, top: 0, keyboard: false },
  );
});

test("desktop and pinch zoom preserve the browser's own layout", () => {
  assert.equal(
    mobileViewportMetrics({ mobile: false, layoutHeight: 1000 }),
    null,
  );
  for (const scale of [0.8, 1.1, 2]) {
    assert.equal(
      mobileViewportMetrics({ mobile: true, layoutHeight: 844, scale }),
      null,
    );
  }
});

test("missing visual viewport uses the window and transient overscroll stays bounded", () => {
  assert.deepEqual(mobileViewportMetrics({ mobile: true, layoutHeight: 844 }), {
    height: 844,
    top: 0,
    keyboard: false,
  });
  assert.deepEqual(
    mobileViewportMetrics({
      mobile: true,
      layoutHeight: 844,
      visualHeight: 900,
      visualOffsetTop: -30,
    }),
    { height: 844, top: 0, keyboard: false },
  );
  assert.deepEqual(
    mobileViewportMetrics({
      mobile: true,
      layoutHeight: 844,
      visualHeight: 460,
      visualOffsetTop: 500,
    }),
    { height: 460, top: 384, keyboard: false },
  );
  for (const invalid of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      mobileViewportMetrics({
        mobile: true,
        layoutHeight: 844,
        visualHeight: invalid,
        visualOffsetTop: invalid,
      }),
      { height: 844, top: 0, keyboard: false },
    );
  }
});
