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
