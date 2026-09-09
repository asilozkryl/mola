import assert from "node:assert/strict";
import test from "node:test";
import type { DraftState } from "../shared/collaboration-types";
import type { Attachment } from "../shared/types";
import {
  attachmentMetadata,
  draftMatchesSent,
  draftReception,
  mergeDraftAttachments,
  readDraftConflict,
  type DraftValue,
} from "../src/lib/draft-value";

const file = (id: string, name = `${id}.txt`): Attachment => ({
  id,
  name,
  size: 12,
  mime: "text/plain",
  url: `/api/uploads/${id}`,
});

test("a restored send conflict retains both its remote choice and unavailable attachment metadata in its exact scope", () => {
  const scope = {
    userId: "user",
    workspaceId: "workspace",
    channelId: "channel",
    parentId: "thread",
  };
  const id = "13605422-4585-4709-9de6-195d574d823e";
  const conflict = {
    ...remote(value("Diğer cihazın yeni taslağı", [id]), 12),
    unavailableAttachmentIds: [id],
  };
  const cache = JSON.parse(
    JSON.stringify({
      scope,
      conflict,
      content: "Gönderilemeyen yerel taslak",
      base: conflict.content,
      revision: conflict.revision,
    }),
  );
  assert.deepEqual(readDraftConflict(cache, scope), conflict);
  for (const key of [
    "userId",
    "workspaceId",
    "channelId",
    "parentId",
  ] as const) {
    assert.equal(
      readDraftConflict(cache, { ...scope, [key]: "different" }),
      null,
    );
  }
});

test("invalid stored conflict revisions or attachment ownership are rejected", () => {
  const scope = {
    userId: "user",
    workspaceId: "workspace",
    channelId: "channel",
    parentId: "",
  };
  const conflict = remote(value("Uzak taslak"), 2);
  assert.equal(
    readDraftConflict(
      { scope, conflict: { ...conflict, revision: -1 } },
      scope,
    ),
    null,
  );
  assert.equal(
    readDraftConflict(
      {
        scope,
        conflict: { ...conflict, attachments: [file("outside-draft")] },
      },
      scope,
    ),
    null,
  );
  assert.equal(
    readDraftConflict(
      {
        scope,
        conflict: { ...conflict, unavailableAttachmentIds: ["outside-draft"] },
      },
      scope,
    ),
    null,
  );
  assert.equal(readDraftConflict({ conflict }, scope), null);
});
const value = (content: string, attachmentIds: string[] = []): DraftValue => ({
  content,
  attachmentIds,
});
const remote = (draft: DraftValue, revision: number): DraftState => ({
  ...draft,
  revision,
  updatedAt: null,
  attachments: draft.attachmentIds.map((id) => file(id)),
  unavailableAttachmentIds: [],
});

test("same text with independently selected files conflicts instead of silently choosing one device", () => {
  const base = value("Ortak not"),
    local = value("Ortak not", ["local-file"]);
  assert.equal(
    draftReception(
      local,
      base,
      null,
      4,
      remote(value("Ortak not", ["remote-file"]), 5),
    ),
    "conflict",
  );
  assert.equal(
    draftReception(
      local,
      base,
      null,
      4,
      remote(value("Ortak not", ["local-file"]), 5),
    ),
    "accept",
  );
});

test("a delayed save acknowledgement advances the base without replacing a later file selection", () => {
  const base = value("Not"),
    pending = value("Not", ["first-file"]),
    local = value("Not", ["first-file", "second-file"]);
  const acknowledgement = remote(pending, 2);
  assert.equal(
    draftReception(local, base, pending, 1, acknowledgement),
    "acknowledge",
  );
  assert.equal(
    draftReception(
      local,
      acknowledgement,
      null,
      2,
      remote(value("Not", ["other-device"]), 3),
    ),
    "conflict",
  );
  assert.equal(
    draftReception(value(""), value(""), pending, 3, acknowledgement),
    "stale",
  );
});

test("successful delivery only clears its exact attachment selection and never a newer equal-looking draft", () => {
  const sent = { ...value("Not", ["file-a"]), draftRevision: 6 };
  assert.equal(draftMatchesSent(value("  Not \n", ["file-a"]), 6, sent), true);
  assert.equal(draftMatchesSent(value("Not", ["file-b"]), 6, sent), false);
  assert.equal(draftMatchesSent(value("Not", ["file-a"]), 7, sent), false);
  assert.equal(draftMatchesSent(value("Yeni not", ["file-a"]), 6, sent), false);
});

test("missing attachments retain cached filenames while available metadata refreshes and removed files disappear", () => {
  const cached = [
    file("missing", "Eski rapor.pdf"),
    file("current", "Old.txt"),
    file("removed"),
  ];
  const incoming = [file("current", "Current.txt")];
  assert.deepEqual(
    mergeDraftAttachments(["current", "missing"], cached, incoming).map(
      ({ id, name }) => ({ id, name }),
    ),
    [
      { id: "current", name: "Current.txt" },
      { id: "missing", name: "Eski rapor.pdf" },
    ],
  );
  assert.deepEqual(
    attachmentMetadata([
      {
        ...file("current"),
        bytes: new Uint8Array([1, 2]),
        fileObject: { type: "File" },
      },
    ]),
    incoming.map(() => file("current")),
  );
});
