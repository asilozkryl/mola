import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightSearchText } from "../src/lib/search-highlight";

test("search highlighting keeps Turkish case and original Unicode graphemes intact", () => {
  assert.deepEqual(highlightSearchText("İZMİR ve IŞIK", "izmir"), [
    { text: "İZMİR", match: true },
    { text: " ve IŞIK", match: false },
  ]);
  assert.deepEqual(highlightSearchText("I\u0307zmir", "izmir"), [
    { text: "I\u0307zmir", match: true },
  ]);
  assert.deepEqual(highlightSearchText("Bir ﬃ denemesi", "ffi"), [
    { text: "Bir ", match: false },
    { text: "ﬃ", match: true },
    { text: " denemesi", match: false },
  ]);
});

test("highlighting treats HTML and regex punctuation literally and preserves the complete text", () => {
  const text = "<script>.+</script> 🙂 .+";
  const parts = highlightSearchText(text, ".+");
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(
    parts.filter((part) => part.match).map((part) => part.text),
    [".+", ".+"],
  );
  assert.deepEqual(highlightSearchText("Bir mesaj", ""), [
    { text: "Bir mesaj", match: false },
  ]);
  assert.deepEqual(highlightSearchText("Bir mesaj", "başka"), [
    { text: "Bir mesaj", match: false },
  ]);
});
