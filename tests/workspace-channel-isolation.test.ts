import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import type {
  Bootstrap,
  Channel,
  Message,
  VoiceRoster,
} from "../shared/types.js";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";

const origin = "http://workspace-channel-isolation.test";
type Session = { id: string; cookie: string };

for (const entry of ["new registration", "existing account join"] as const) {
  test(`${entry} grants workspace membership without private text, file or voice access`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "mola-channel-isolation-"));
    const runtime = createApp({
      dataDir: directory,
      appOrigin: origin,
      production: false,
      requireEmailVerification: false,
    });
    const clients: Socket[] = [];
    await new Promise<void>((done) =>
      runtime.server.listen(0, "127.0.0.1", done),
    );
    const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
    const session = (id: string, workspaceId: string): Session => {
      const token = randomBytes(32).toString("hex");
      runtime.repo.run(
        "INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES (?,?,?,?)",
        createHash("sha256").update(token).digest("hex"),
        id,
        Date.now() + 600_000,
        workspaceId,
      );
      return { id, cookie: `mola_session=${token}` };
    };
    const request = (
      actor: Session | null,
      path: string,
      method = "GET",
      body?: unknown,
    ) =>
      fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: origin,
          ...(actor ? { Cookie: actor.cookie } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const socket = async (actor: Session) => {
      const client = connect(base, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        timeout: 2500,
        extraHeaders: { Origin: origin, Cookie: actor.cookie },
      });
      clients.push(client);
      await new Promise<void>((done, reject) => {
        client.once("connect", done);
        client.once("connect_error", reject);
      });
      return client;
    };
    const roster = (client: Socket) => {
      const result = new Promise<VoiceRoster>((done) =>
        client.once("voice:roster", done),
      );
      client.emit("voice:roster:request");
      return result;
    };
    try {
      const seed = createWorkspace(runtime.repo, {
        name: "Inviting Workspace",
        userName: "Workspace Owner",
        email: "owner@channel-isolation.test",
        passwordHash: null,
      });
      const owner = session(seed.userId, seed.workspaceId);
      const createChannel = async (
        name: string,
        kind: "text" | "voice",
        visibility: "public" | "private",
      ) => {
        const result = await request(owner, "/channels", "POST", {
          name,
          kind,
          visibility,
        });
        assert.equal(result.status, 201);
        return (await result.json()) as Channel;
      };
      // All channels predate the invitation, including an occupied private call.
      const privateText = await createChannel(
        "Existing secret",
        "text",
        "private",
      );
      const privateVoice = await createChannel(
        "Existing private voice",
        "voice",
        "private",
      );
      const publicText = await createChannel(
        "Visible team channel",
        "text",
        "public",
      );
      const marker = "invitation-isolation-secret";
      const createdMessage = await request(
        owner,
        `/channels/${privateText.id}/messages`,
        "POST",
        { content: marker },
      );
      assert.equal(createdMessage.status, 201);
      const message = (await createdMessage.json()) as Message;
      const attachmentId = randomUUID();
      await writeFile(
        join(directory, "uploads", `${attachmentId}.bin`),
        marker,
      );
      runtime.repo.run(
        "INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)",
        attachmentId,
        seed.workspaceId,
        owner.id,
        message.id,
        "secret.txt",
        Buffer.byteLength(marker),
        "text/plain",
        `${attachmentId}.bin`,
        new Date().toISOString(),
      );
      const ownerSocket = await socket(owner);
      assert.equal(
        (
          await ownerSocket
            .timeout(2500)
            .emitWithAck("call:join", { channelId: privateVoice.id })
        ).ok,
        true,
      );
      const invitation = await request(owner, "/invites", "POST");
      assert.equal(invitation.status, 201);
      const token = new URL((await invitation.json()).url).searchParams.get(
        "invite",
      )!;
      let invited: Session;
      let initial: Bootstrap;
      if (entry === "new registration") {
        const registered = await request(null, "/auth/register", "POST", {
          name: "New Invitee",
          email: "invitee@channel-isolation.test",
          password: "invitation-isolation-password",
          inviteToken: token,
        });
        assert.equal(registered.status, 200);
        initial = (await registered.json()) as Bootstrap;
        const cookie = registered.headers.get("set-cookie")?.split(";")[0];
        assert.ok(cookie);
        invited = { id: initial.user.id, cookie };
      } else {
        const existing = createWorkspace(runtime.repo, {
          name: "Invitee Home Workspace",
          userName: "Existing Invitee",
          email: "existing@channel-isolation.test",
          passwordHash: null,
        });
        invited = session(existing.userId, existing.workspaceId);
        const joined = await request(invited, "/workspaces/join", "POST", {
          inviteToken: token,
        });
        assert.equal(joined.status, 200);
        initial = (await joined.json()) as Bootstrap;
        assert.equal(
          runtime.repo.member(invited.id, existing.workspaceId)?.role,
          "owner",
        );
      }
      assert.equal(initial.workspace.id, seed.workspaceId);
      assert.equal(
        initial.user.role,
        "member",
        "ownership elsewhere cannot elevate an invitee",
      );
      const assertHidden = async (state?: Bootstrap) => {
        const current =
          state ??
          ((await (await request(invited, "/auth/me")).json()) as Bootstrap);
        const ids = current.channels.map((channel) => channel.id);
        assert.ok(ids.includes(publicText.id));
        assert.ok(!ids.includes(privateText.id));
        assert.ok(!ids.includes(privateVoice.id));
        assert.ok(
          !current.voiceChannels.some(
            (channel) => channel.channelId === privateVoice.id,
          ),
        );
        for (const path of [
          `/channels/${privateText.id}/access`,
          `/channels/${privateText.id}/messages`,
          `/channels/${privateText.id}/pins`,
          `/channels/${privateText.id}/files`,
          `/messages/${message.id}`,
          `/files/${attachmentId}`,
        ])
          assert.equal((await request(invited, path)).status, 404, path);
        assert.equal(
          (
            await request(
              invited,
              `/channels/${privateText.id}/messages`,
              "POST",
              { content: "must not be written" },
            )
          ).status,
          404,
        );
        const search = await (
          await request(invited, `/search?q=${marker}`)
        ).json();
        assert.deepEqual(search.messages, []);
        const scopedSearch = await (
          await request(invited, `/search?channelId=${privateText.id}`)
        ).json();
        assert.deepEqual(scopedSearch.messages, []);
        assert.equal(
          (await request(invited, `/channels/${publicText.id}/messages`))
            .status,
          200,
        );
        assert.equal(
          runtime.repo.get(
            "SELECT COUNT(*) AS n FROM channel_members WHERE user_id=?",
            invited.id,
          )!.n,
          0,
        );
      };
      await assertHidden(initial);
      let invitedSocket = await socket(invited);
      const assertSocketHidden = async () => {
        const rooms = runtime.io.sockets.sockets.get(invitedSocket.id!)!.rooms;
        assert.ok(rooms.has(`channel:${publicText.id}`));
        assert.ok(!rooms.has(`channel:${privateText.id}`));
        assert.ok(!rooms.has(`channel:${privateVoice.id}`));
        assert.deepEqual((await roster(invitedSocket)).channels, []);
        for (const channelId of [privateText.id, privateVoice.id]) {
          const joined = await invitedSocket
            .timeout(2500)
            .emitWithAck("call:join", { channelId });
          assert.equal(
            joined.ok,
            false,
            "knowing a hidden channel ID cannot authorize a call",
          );
        }
      };
      await assertSocketHidden();
      const received: Message[] = [];
      invitedSocket.on("message:created", (value: Message) =>
        received.push(value),
      );
      await request(owner, `/channels/${privateText.id}/messages`, "POST", {
        content: "hidden live message",
      });
      // A later public event provides an ordered socket delivery barrier.
      const publicDelivered = new Promise<Message>((done) =>
        invitedSocket.once("message:created", done),
      );
      await request(owner, `/channels/${publicText.id}/messages`, "POST", {
        content: "public live barrier",
      });
      assert.equal((await publicDelivered).channelId, publicText.id);
      assert.deepEqual(
        received.map((value) => value.channelId),
        [publicText.id],
      );

      for (const channelId of [privateText.id, privateVoice.id]) {
        const granted = await request(
          owner,
          `/channels/${channelId}/access`,
          "PATCH",
          {
            visibility: "private",
            memberIds: [owner.id, invited.id],
          },
        );
        assert.equal(granted.status, 200);
      }
      const granted = (await (
        await request(invited, "/auth/me")
      ).json()) as Bootstrap;
      assert.ok(
        granted.channels.some((channel) => channel.id === privateText.id),
      );
      assert.ok(
        granted.channels.some((channel) => channel.id === privateVoice.id),
      );
      assert.ok(
        granted.voiceChannels.some(
          (channel) => channel.channelId === privateVoice.id,
        ),
      );
      const privateMessages = await (
        await request(invited, `/channels/${privateText.id}/messages`)
      ).json();
      assert.ok(
        privateMessages.messages.some(
          (value: Message) => value.id === message.id,
        ),
      );
      assert.equal(
        (await request(invited, `/files/${attachmentId}`)).status,
        200,
      );
      const visibleSearch = await (
        await request(invited, `/search?q=${marker}`)
      ).json();
      assert.deepEqual(
        visibleSearch.messages.map((value: Message) => value.id),
        [message.id],
      );
      assert.equal(
        (
          await invitedSocket
            .timeout(2500)
            .emitWithAck("call:join", { channelId: privateVoice.id })
        ).ok,
        true,
      );

      const disconnected = new Promise<void>((done) =>
        invitedSocket.once("disconnect", () => done()),
      );
      for (const channelId of [privateText.id, privateVoice.id]) {
        const revoked = await request(
          owner,
          `/channels/${channelId}/access`,
          "PATCH",
          {
            visibility: "private",
            memberIds: [owner.id],
          },
        );
        assert.equal(revoked.status, 200);
      }
      await disconnected;
      await assertHidden();
      const membership = runtime.repo.member(invited.id, seed.workspaceId)!;
      assert.equal(membership.role, "member");
      assert.equal(membership.membership_removed_at, null);
      assert.equal(membership.membership_suspended_at, null);
      invitedSocket = await socket(invited);
      await assertSocketHidden();
      const ownerRoster = await roster(ownerSocket);
      assert.deepEqual(
        ownerRoster.channels[0]?.peers.map((peer) => peer.user.id),
        [owner.id],
      );

      // Reusing the workspace invitation must never undo a channel-level removal.
      const repeated = await request(invited, "/workspaces/join", "POST", {
        inviteToken: token,
      });
      assert.equal(repeated.status, 200);
      await assertHidden((await repeated.json()) as Bootstrap);
    } finally {
      for (const client of clients) client.disconnect();
      await runtime.close();
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
      assert.ok(directory.includes("mola-channel-isolation-"));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
