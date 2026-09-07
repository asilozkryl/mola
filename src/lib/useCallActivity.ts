import { useEffect, useState, type RefObject } from "react";
import type { ConnectionQuality } from "../../shared/call-types";
import { monitorAudio } from "./audioMeter";
import { sampleConnectionQuality, type PacketSample } from "./callQuality";
import { sampleAudioStats } from "./rtcAudioLevel";

interface ActivityPeer {
  pc: RTCPeerConnection;
  user: { mic: boolean };
  stream: MediaStream;
  audio?: RTCRtpTransceiver;
}

export function useCallActivity({
  joined,
  localStream,
  connections,
  stateRef,
}: {
  joined: boolean;
  localStream: MediaStream | null;
  connections: RefObject<Map<string, ActivityPeer>>;
  stateRef: RefObject<{ mic: boolean }>;
}) {
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [quality, setQuality] = useState<Record<string, ConnectionQuality>>({});
  const localTrack = localStream?.getAudioTracks()[0];

  useEffect(() => {
    setSpeaking({});
    setQuality({});
    if (!joined) return;
    let cancelled = false;
    const pending = new Map<string, ActivityPeer>();
    const nextQualityAt = new Map<string, number>();
    const reports = new Map<
      string,
      { local: number | null; remote: number | null; sampledAt: number }
    >();
    const audioCounters = new Map<string, Map<string, number>>();
    const packetCounters = new Map<string, Map<string, PacketSample>>();
    const lastActive: Record<string, number> = {};
    const microphone = localTrack ? new MediaStream([localTrack]) : null;
    let fallbackLevels: Record<string, number> = {},
      fallbackKey = "";
    let stopFallback: (() => void) | undefined;

    const collect = () => {
      if (cancelled) return;
      for (const [id, peer] of connections.current) {
        if (peer.pc.connectionState !== "connected" || pending.get(id) === peer)
          continue;
        pending.set(id, peer);
        // This never synchronously waits for WebRTC's worker. Each peer has its
        // own pending guard, so one stalled report cannot stop the other peers.
        void peer.pc
          .getStats()
          .then((stats) => {
            if (
              cancelled ||
              connections.current.get(id) !== peer ||
              peer.pc.connectionState !== "connected"
            )
              return;
            const counters = audioCounters.get(id) ?? new Map<string, number>();
            audioCounters.set(id, counters);
            const now = performance.now();
            reports.set(id, {
              local: sampleAudioStats(
                stats,
                "local",
                localTrack?.id,
                counters,
                now,
                performance.timeOrigin,
              ),
              remote: sampleAudioStats(
                stats,
                "remote",
                undefined,
                counters,
                now,
                performance.timeOrigin,
              ),
              sampledAt: now,
            });
            if (now >= (nextQualityAt.get(id) ?? 0)) {
              const packets =
                packetCounters.get(id) ?? new Map<string, PacketSample>();
              packetCounters.set(id, packets);
              const value = sampleConnectionQuality(stats, packets);
              nextQualityAt.set(id, now + 2500);
              setQuality((current) => ({ ...current, [id]: value }));
            }
          })
          .catch(() => {
            if (!cancelled && connections.current.get(id) === peer) {
              reports.set(id, {
                local: null,
                remote: null,
                sampledAt: performance.now(),
              });
              setQuality((current) => {
                if (!(id in current)) return current;
                const next = { ...current };
                delete next[id];
                return next;
              });
            }
          })
          .finally(() => {
            if (pending.get(id) === peer) pending.delete(id);
          });
      }
      for (const id of reports.keys())
        if (!connections.current.has(id)) {
          reports.delete(id);
          audioCounters.delete(id);
          packetCounters.delete(id);
          nextQualityAt.delete(id);
        }
      const hasCurrentQuality = (id: string) =>
        connections.current.get(id)?.pc.connectionState === "connected" &&
        performance.now() - (reports.get(id)?.sampledAt ?? -Infinity) < 7500;
      setQuality((current) =>
        Object.keys(current).some((id) => !hasCurrentQuality(id))
          ? Object.fromEntries(
              Object.entries(current).filter(([id]) => hasCurrentQuality(id)),
            )
          : current,
      );
    };

    const sample = () => {
      const now = performance.now();
      const next: Record<string, boolean> = {};
      const fallback: { id: string; stream: MediaStream }[] = [];
      const mark = (id: string, level: number, allowed: boolean) => {
        if (!allowed) delete lastActive[id];
        else if (level >= 0.018) lastActive[id] = now;
        next[id] =
          allowed && lastActive[id] !== undefined && now - lastActive[id] < 600;
      };
      const localMeasurements: (number | null)[] = [];
      let hasSender = false;
      for (const [id, peer] of connections.current) {
        const connected = peer.pc.connectionState === "connected";
        const report = reports.get(id);
        const fresh = report && now - report.sampledAt < 1000;
        if (connected && peer.audio?.sender.track === localTrack) {
          hasSender = true;
          if (report)
            localMeasurements.push(
              report.local === null ? null : fresh ? report.local : 0,
            );
        }
        const allowed = connected && peer.user.mic;
        let level = report?.remote === null ? null : fresh ? report.remote : 0;
        if (allowed && level === null) {
          fallback.push({ id, stream: peer.stream });
          level = fallbackLevels[id] ?? 0;
        }
        mark(id, level ?? 0, allowed);
      }
      const localAllowed = Boolean(
        stateRef.current.mic &&
        localTrack?.enabled &&
        !localTrack.muted &&
        localTrack.readyState === "live",
      );
      const measuredLocal = localMeasurements.filter((level) => level !== null);
      const nativeLocal = measuredLocal.length
        ? Math.max(...measuredLocal)
        : undefined;
      const needLocalFallback =
        !hasSender ||
        (localMeasurements.length > 0 && nativeLocal === undefined);
      if (localAllowed && microphone && needLocalFallback)
        fallback.push({ id: "local", stream: microphone });
      mark(
        "local",
        needLocalFallback ? (fallbackLevels.local ?? 0) : (nativeLocal ?? 0),
        localAllowed,
      );
      const key = fallback
        .map(
          ({ id, stream }) =>
            `${id}:${stream
              .getAudioTracks()
              .map((track) => track.id)
              .join(",")}`,
        )
        .sort()
        .join(";");
      if (key !== fallbackKey) {
        stopFallback?.();
        fallbackLevels = {};
        fallbackKey = key;
        stopFallback = fallback.length
          ? monitorAudio(fallback, (levels) => {
              fallbackLevels = levels;
            })
          : undefined;
      }
      for (const id of Object.keys(lastActive))
        if (!(id in next)) delete lastActive[id];
      setSpeaking((current) =>
        Object.keys({ ...current, ...next }).every(
          (id) => current[id] === next[id],
        )
          ? current
          : next,
      );
    };
    sample();
    void collect();
    const activityTimer = window.setInterval(sample, 100);
    const statsTimer = window.setInterval(() => void collect(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(activityTimer);
      window.clearInterval(statsTimer);
      stopFallback?.();
    };
  }, [joined, localTrack, connections, stateRef]);

  return { speaking, quality };
}
