export interface TwoFactorChallenge {
  twoFactorRequired: true;
  expiresAt: number;
}
export interface SecurityStatus {
  enabled: boolean;
  enabledAt: number | null;
  recoveryCodesRemaining: number;
}
export interface SecuritySetup {
  secret: string;
  uri: string;
  expiresAt: number;
}
export interface RecoveryCodes {
  recoveryCodes: string[];
}
export interface AccountSession {
  id: string;
  device: string;
  current: boolean;
  createdAt: number | null;
  lastSeenAt: number | null;
  expiresAt: number;
}
