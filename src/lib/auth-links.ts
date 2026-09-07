export type AuthLink = {
  action: "verify-email" | "reset-password";
  token: string;
};

export function readAuthLink(): AuthLink | null {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const params = hash.has("action") ? hash : query;
  const action = params.get("action");
  if (action !== "verify-email" && action !== "reset-password") return null;
  return { action, token: params.get("token") || "" };
}

export function clearAuthLink() {
  const url = new URL(location.href);
  url.searchParams.delete("action");
  url.searchParams.delete("token");
  url.hash = "";
  history.replaceState(null, "", url.pathname + url.search);
}
