import type { SessionBootstrap } from "../../shared/types";
import { readAuthLink } from "./auth-links";
let activeWorkspaceId: string | undefined;
export function setApiWorkspace(workspaceId?: string) {
  activeWorkspaceId = workspaceId;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(activeWorkspaceId ? { "X-Workspace-Id": activeWorkspaceId } : {}),
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 409 && body.code === "WORKSPACE_CHANGED")
    window.dispatchEvent(new Event("mola:workspace-changed"));
  if (!response.ok)
    throw new ApiError(
      typeof body.error === "string"
        ? body.error
        : body.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
      response.status,
      body.code,
      body,
    );
  return body as T;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function bootstrap(): Promise<SessionBootstrap | null> {
  if (readAuthLink()) {
    sessionStorage.setItem("mola:logged-out", "true");
    return null;
  }
  try {
    return await api<SessionBootstrap>("/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const config = await api<{ demoEnabled: boolean }>("/config");
    if (
      config.demoEnabled &&
      !sessionStorage.getItem("mola:logged-out") &&
      !readAuthLink() &&
      !new URLSearchParams(location.search).has("profile") &&
      !new URLSearchParams(location.search).has("invite")
    )
      return post<SessionBootstrap>("/auth/demo");
    return null;
  }
}
