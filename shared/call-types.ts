export interface CallPreferences {
  inputDeviceId: string;
  outputDeviceId: string;
  startMuted: boolean;
}

export interface ConnectionQuality {
  level: "unknown" | "good" | "fair" | "poor";
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
}

/** Public account-session identity; authentication tokens are never exposed. */
export interface CallDevice {
  id: string;
  name: string;
}

export interface CallTransfer {
  id: string;
  channelId: string;
  channelName: string;
  sourceSocketId: string;
  sourceDevice: string;
  targetDevice: string;
  expiresAt: number;
  mic: boolean;
}

export interface CallTransferStatus {
  id: string;
  state: "completed" | "cancelled";
  reason?: string;
  /** Latest source state, captured when the transfer commits. */
  mic?: boolean;
}

export type CallTransferAck =
  | { ok: true; transfer: CallTransfer }
  | { ok: false; error: string };

export type CallDevicesAck =
  | { ok: true; devices: CallDevice[] }
  | { ok: false; error: string };
