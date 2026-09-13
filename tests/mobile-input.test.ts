import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldSendComposerKey } from "../src/lib/mobileInput";

test("touch Return leaves a multiline draft until an explicit send shortcut", () => {
  assert.equal(shouldSendComposerKey({ key: "Enter" }, true), false);
  assert.equal(
    shouldSendComposerKey({ key: "Enter", ctrlKey: true }, true),
    true,
  );
  assert.equal(
    shouldSendComposerKey({ key: "Enter", metaKey: true }, true),
    true,
  );
});

test("desktop Enter sends while modified newline and non-Enter keys do not", () => {
  assert.equal(shouldSendComposerKey({ key: "Enter" }, false), true);
  for (const coarse of [false, true]) {
    for (const event of [
      { key: "Enter", shiftKey: true },
      { key: "Enter", ctrlKey: true, shiftKey: true },
      { key: "Enter", altKey: true },
      { key: "b", ctrlKey: true },
    ]) {
      assert.equal(shouldSendComposerKey(event, coarse), false);
    }
  }
});

test("IME confirmation and held Return never submit a draft", () => {
  for (const coarse of [false, true]) {
    for (const event of [
      { key: "Enter", isComposing: true },
      { key: "Enter", keyCode: 229 },
      { key: "Enter", ctrlKey: true, isComposing: true },
      { key: "Enter", metaKey: true, keyCode: 229 },
      { key: "Enter", ctrlKey: true, repeat: true },
    ]) {
      assert.equal(shouldSendComposerKey(event, coarse), false);
    }
  }
});
