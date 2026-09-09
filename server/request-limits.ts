import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/** A 30-person benchmark sends 1,650 HTTP requests/minute (55 per person).
 * Keep the existing 300/minute individual allowance and a separate network
 * ceiling, allowing the measured office cohort without removing flood control.
 */
export const API_REQUEST_LIMIT = 300;
export const API_NETWORK_LIMIT = 6_000;

export function apiRequestLimit(
  production: boolean,
  environment = process.env,
) {
  const raw = environment.MOLA_TEST_API_LIMIT?.trim() || "";
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return !production &&
    environment.NODE_ENV === "test" &&
    Number.isInteger(value) &&
    value >= API_REQUEST_LIMIT &&
    value <= 5_000
    ? value
    : API_REQUEST_LIMIT;
}

/** resolveUserId must look up a server-validated session, never a request header.
 * This resolves quota identity only; route authentication and access checks stay
 * authoritative and must still run before protected handlers.
 */
export function createRequestLimits({
  production,
  resolveUserId,
}: {
  production: boolean;
  resolveUserId: (request: Request) => string | undefined;
}) {
  const networkKey = (request: Request) =>
    ipKeyGenerator(request.ip || request.socket.remoteAddress || "unknown");
  const ipGuard = rateLimit({
    windowMs: 60_000,
    limit: API_NETWORK_LIMIT,
    keyGenerator: networkKey,
    identifier: "api-network",
    standardHeaders: "draft-8",
    legacyHeaders: false,
    requestPropertyName: "networkRateLimit",
    message: {
      error:
        "Bu bağlantıdan çok fazla istek geliyor. Bir dakika sonra yeniden deneyin.",
      code: "API_NETWORK_RATE_LIMITED",
    },
  });
  const identities = new WeakMap<Request, string | undefined>();
  const principalLimit = rateLimit({
    windowMs: 60_000,
    limit: apiRequestLimit(production),
    keyGenerator: (request) => {
      const userId = identities.get(request);
      return userId ? `user:${userId}` : `anonymous:${networkKey(request)}`;
    },
    identifier: (request) =>
      identities.get(request) ? "api-user" : "api-anonymous",
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Biraz yavaşlayın; bir dakika sonra yeniden deneyin.",
      code: "API_RATE_LIMITED",
    },
  });
  const api: RequestHandler = (request, response, next) => {
    identities.set(request, resolveUserId(request));
    return principalLimit(request, response, next);
  };
  return { ipGuard, api };
}
