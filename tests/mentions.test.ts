import test from "node:test";
import assert from "node:assert/strict";
import { MentionHistory } from "../shared/mention-history";
import {
  decodeMentions,
  encodeMentions,
  mentionPreview,
  replaceMentionRange,
  updateMentionText,
} from "../shared/mentions";

const first = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Deniz Kaya",
};
const second = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Deniz Kaya",
};
const members = [first, second];

test("identical display names retain the surviving target when either mention is removed", () => {
  const document = decodeMentions(`@[${first.id}] @[${second.id}]`, members);
  assert.equal(document.text, "@Deniz Kaya @Deniz Kaya");
  const withoutFirst = updateMentionText(document, "@Deniz Kaya", 0);
  assert.equal(encodeMentions(withoutFirst), `@[${second.id}]`);
  const withoutSecond = updateMentionText(document, "@Deniz Kaya", 11);
  assert.equal(encodeMentions(withoutSecond), `@[${first.id}]`);
});

test("typing before and between mentions and wrapping a selection preserves both identities", () => {
  const document = decodeMentions(`@[${first.id}] @[${second.id}]`, members);
  const prefixed = updateMentionText(document, `Merhaba ${document.text}`, 8);
  assert.equal(
    encodeMentions(prefixed),
    `Merhaba @[${first.id}] @[${second.id}]`,
  );
  const between = replaceMentionRange(document, 12, 12, "ve ");
  assert.equal(encodeMentions(between), `@[${first.id}] ve @[${second.id}]`);
  const wrapped = replaceMentionRange(
    replaceMentionRange(document, 11, 11, "**"),
    0,
    0,
    "**",
  );
  assert.equal(encodeMentions(wrapped), `**@[${first.id}]** @[${second.id}]`);
});

test("editing part of a name never retargets another intact mention", () => {
  const document = decodeMentions(`@[${first.id}] @[${second.id}]`, members);
  const changed = updateMentionText(document, "@Deniz Kay @Deniz Kaya", 10);
  assert.equal(encodeMentions(changed), `@Deniz Kay @[${second.id}]`);
});

test("inserting a specific member and refreshing names survives serialization", () => {
  const document = replaceMentionRange(
    { text: "Merhaba ", mentions: [] },
    8,
    8,
    "@Deniz Kaya ",
    second,
  );
  const stored = encodeMentions(document);
  assert.equal(stored, `Merhaba @[${second.id}] `);
  const renamed = [first, { ...second, name: "Deniz Yıldız" }];
  assert.equal(decodeMentions(stored, renamed).text, "Merhaba @Deniz Yıldız ");
  assert.equal(encodeMentions(decodeMentions(stored, renamed)), stored);
});

test("plain legacy mentions, pasted tokens and unavailable members remain readable", () => {
  assert.equal(
    mentionPreview("Merhaba @DenizKaya", members),
    "Merhaba @DenizKaya",
  );
  const pasted = updateMentionText(
    { text: "", mentions: [] },
    `@[${second.id}]`,
    39,
  );
  assert.equal(mentionPreview(encodeMentions(pasted), members), "@Deniz Kaya");
  assert.equal(mentionPreview(`Merhaba @[${second.id}]`, []), "Merhaba @Üye");
  assert.equal(
    mentionPreview("Önizleme @[22222222-2222-", members),
    "Önizleme @Üye",
  );
  assert.equal(
    encodeMentions(decodeMentions(`@[${second.id}]`, [])),
    `@[${second.id}]`,
  );
});

test("undo and redo restore the exact duplicate-name targets and selection", () => {
  const original = `@[${first.id}] @[${second.id}]`;
  const history = new MentionHistory(original);
  history.select({ start: 0, end: 12 });
  const changed = encodeMentions(
    updateMentionText(decodeMentions(original, members), "@Deniz Kaya", 0),
  );
  history.record(changed, { start: 0, end: 0 });
  assert.equal(history.current.content, `@[${second.id}]`);
  assert.deepEqual(history.restore(), { content: original, start: 0, end: 12 });
  assert.equal(history.restore(true)?.content, `@[${second.id}]`);
  assert.equal(history.restore()?.content, original);
  history.record(`Merhaba ${original}`, { start: 8, end: 8 });
  assert.equal(
    history.restore(true),
    null,
    "a new edit discards the redo branch",
  );
  assert.equal(history.restore()?.content, original);
});

test("new remote drafts or editor scopes clear the previous target history", () => {
  const history = new MentionHistory(`@[${first.id}]`);
  history.record(`@[${second.id}]`, { start: 11, end: 11 });
  history.reset("Diğer cihazdaki taslak");
  assert.equal(history.restore(), null);
  assert.equal(history.restore(true), null);
  assert.equal(history.current.content, "Diğer cihazdaki taslak");
  history.record(`@[${first.id}]`, { start: 11, end: 11 });
  history.reset("");
  assert.equal(
    history.restore(),
    null,
    "sent messages cannot be restored by undo",
  );
});
