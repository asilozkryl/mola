import type { Bootstrap } from "../../shared/types";
import { readAuthLink } from "./auth-links";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
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
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      typeof body.error === "string"
        ? body.error
        : body.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
      response.status,
      body.code,
    );
  return body as T;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function bootstrap(): Promise<Bootstrap | null> {
  if (readAuthLink()) {
    sessionStorage.setItem("mola:logged-out", "true");
    return null;
  }
  try {
    return await api<Bootstrap>("/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const config = await api<{ demoEnabled: boolean }>("/config");
    if (
      config.demoEnabled &&
      !sessionStorage.getItem("mola:logged-out") &&
      !readAuthLink() &&
      !new URLSearchParams(location.search).has("invite")
    )
      return post<Bootstrap>("/auth/demo");
    return null;
  }
}
