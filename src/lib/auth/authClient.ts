import { createIsomorphicFn } from "@tanstack/react-start";
import { create } from "zustand";
import { sanitizeRedirectTarget } from "./redirect";

export { sanitizeRedirectTarget };

export interface AuthenticatedOwner {
  id: string;
  email: string;
  name: string;
  roleId: "owner";
}

export interface AuthSessionSnapshot {
  authenticated: boolean;
  user: AuthenticatedOwner | null;
  idleExpiresAt: string | null;
  expiresAt: string | null;
  leadPilotAvailable?: boolean;
  checked: boolean;
}

export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

interface AuthStoreState {
  status: AuthStatus;
  user: AuthenticatedOwner | null;
  idleExpiresAt: string | null;
  expiresAt: string | null;
  leadPilotAvailable: boolean;
  lastCheckedAt: number | null;
}

export const AUTH_SYNC_STORAGE_KEY = "scale-flow-auth-sync";
const AUTH_BROADCAST_CHANNEL = "scale-flow-auth";

export const useAuthStore = create<AuthStoreState>(() => ({
  status: "unknown",
  user: null,
  idleExpiresAt: null,
  expiresAt: null,
  leadPilotAvailable: false,
  lastCheckedAt: null,
}));

export function hydrateAuthFromSsr(snapshot: AuthSessionSnapshot): void {
  if (!snapshot.checked) return;
  useAuthStore.setState({
    status: snapshot.authenticated ? "authenticated" : "unauthenticated",
    user: snapshot.authenticated ? snapshot.user : null,
    idleExpiresAt: snapshot.authenticated ? snapshot.idleExpiresAt : null,
    expiresAt: snapshot.authenticated ? snapshot.expiresAt : null,
    leadPilotAvailable: snapshot.authenticated ? Boolean(snapshot.leadPilotAvailable) : false,
    lastCheckedAt: Date.now(),
  });
}

export function clearClientAuthState(): void {
  useAuthStore.setState({
    status: "unauthenticated",
    user: null,
    idleExpiresAt: null,
    expiresAt: null,
    leadPilotAvailable: false,
    lastCheckedAt: Date.now(),
  });
}

export function broadcastAuthSync(event: "login" | "logout" | "logout_all"): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ event, at: Date.now() });
  try {
    localStorage.setItem(AUTH_SYNC_STORAGE_KEY, payload);
  } catch {
    // Ignore storage restriction errors; cross-tab signal is best-effort alongside server revocation.
  }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      ch.postMessage({ event, at: Date.now() });
      ch.close();
    }
  } catch {
    // Ignore if BroadcastChannel is unavailable.
  }
}

export function subscribeAuthSync(
  onEvent: (event: "login" | "logout" | "logout_all") => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (e: StorageEvent) => {
    if (e.key !== AUTH_SYNC_STORAGE_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as { event?: unknown };
      if (parsed.event === "login" || parsed.event === "logout" || parsed.event === "logout_all") {
        onEvent(parsed.event);
      }
    } catch {
      // ignore malformed signal
    }
  };
  window.addEventListener("storage", handleStorage);

  let channel: BroadcastChannel | null = null;
  const handleChannel = (ev: MessageEvent<{ event?: unknown }>) => {
    const type = ev.data?.event;
    if (type === "login" || type === "logout" || type === "logout_all") {
      onEvent(type);
    }
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      channel.addEventListener("message", handleChannel);
    }
  } catch {
    channel = null;
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    if (channel) {
      channel.removeEventListener("message", handleChannel);
      channel.close();
    }
  };
}

/**
 * Reads verified session context on the server directly from `AsyncLocalStorage` (zero HTTP hop)
 * and reuses in-memory client auth state on subsequent SPA navigations.
 */
export const readInitialAuthState = createIsomorphicFn()
  .server(async (): Promise<AuthSessionSnapshot> => {
    const { getRequestAuthContext } = await import("@/server/auth/requestContext.server");
    const ctx = getRequestAuthContext();
    return {
      authenticated: ctx.authenticated,
      user: ctx.user,
      idleExpiresAt: ctx.idleExpiresAt,
      expiresAt: ctx.expiresAt,
      leadPilotAvailable: Boolean(ctx.authenticated && ctx.leadPilotAvailable),
      checked: true,
    };
  })
  .client(async (): Promise<AuthSessionSnapshot> => {
    const state = useAuthStore.getState();
    if (state.status !== "unknown") {
      return {
        authenticated: state.status === "authenticated",
        user: state.user,
        idleExpiresAt: state.idleExpiresAt,
        expiresAt: state.expiresAt,
        leadPilotAvailable: state.status === "authenticated" && state.leadPilotAvailable,
        checked: true,
      };
    }
    return {
      authenticated: false,
      user: null,
      idleExpiresAt: null,
      expiresAt: null,
      leadPilotAvailable: false,
      checked: false,
    };
  });

export type RefreshSessionResult =
  | {
      ok: true;
      authenticated: true;
      user: AuthenticatedOwner;
      idleExpiresAt: string;
      expiresAt: string;
    }
  | {
      ok: true;
      authenticated: false;
      reason?: string;
    }
  | {
      ok: false;
      unavailable: true;
      message: string;
    };

export async function refreshAuthSession(): Promise<RefreshSessionResult> {
  try {
    const response = await fetch("/api/v1/auth/session", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      authenticated?: boolean;
      user?: AuthenticatedOwner;
      session?: { idleExpiresAt?: string; expiresAt?: string };
      features?: { leadPilotAvailable?: boolean };
      error?: { code?: string; reason?: string; message?: string };
    } | null;

    if (response.ok && data?.ok && data.authenticated && data.user) {
      const idleExpiresAt = data.session?.idleExpiresAt ?? null;
      const expiresAt = data.session?.expiresAt ?? null;
      const leadPilotAvailable = Boolean(data.features?.leadPilotAvailable);
      useAuthStore.setState({
        status: "authenticated",
        user: data.user,
        idleExpiresAt,
        expiresAt,
        leadPilotAvailable,
        lastCheckedAt: Date.now(),
      });
      return {
        ok: true,
        authenticated: true,
        user: data.user,
        idleExpiresAt: idleExpiresAt ?? "",
        expiresAt: expiresAt ?? "",
      };
    }

    clearClientAuthState();

    if (response.status >= 500) {
      return {
        ok: false,
        unavailable: true,
        message: data?.error?.message ?? "Authentication database is unavailable.",
      };
    }

    return {
      ok: true,
      authenticated: false,
      ...(data?.error?.reason ? { reason: data.error.reason } : {}),
    };
  } catch {
    clearClientAuthState();
    return {
      ok: false,
      unavailable: true,
      message: "Unable to verify your session right now.",
    };
  }
}

export type LoginActionResult =
  | { ok: true; user: AuthenticatedOwner }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      retryAfterSeconds?: number;
    };

export async function loginWithOwnerCredentials(
  email: string,
  password: string,
): Promise<LoginActionResult> {
  try {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      authenticated?: boolean;
      user?: AuthenticatedOwner;
      session?: { idleExpiresAt?: string; expiresAt?: string };
      features?: { leadPilotAvailable?: boolean };
      error?: { code?: string; message?: string; retryAfterSeconds?: number };
    } | null;

    if (response.ok && data?.ok && data.authenticated && data.user) {
      useAuthStore.setState({
        status: "authenticated",
        user: data.user,
        idleExpiresAt: data.session?.idleExpiresAt ?? null,
        expiresAt: data.session?.expiresAt ?? null,
        leadPilotAvailable: Boolean(data.features?.leadPilotAvailable),
        lastCheckedAt: Date.now(),
      });
      broadcastAuthSync("login");
      return { ok: true, user: data.user };
    }

    return {
      ok: false,
      status: response.status,
      code: data?.error?.code ?? "login_failed",
      message: data?.error?.message ?? "Sign-in failed. Please try again.",
      ...(data?.error?.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: data.error.retryAfterSeconds }
        : {}),
    };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: "Unable to reach the authentication server.",
    };
  }
}

export async function logoutOwner(
  options: {
    allSessions?: boolean;
    reason?: string;
  } = {},
): Promise<{ ok: boolean; error?: string }> {
  const endpoint = options.allSessions ? "/api/v1/auth/logout-all" : "/api/v1/auth/logout";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    });

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    } | null;

    clearClientAuthState();
    broadcastAuthSync(options.allSessions ? "logout_all" : "logout");

    const nextTarget = options.reason
      ? `/login?reason=${encodeURIComponent(options.reason)}`
      : "/login";
    if (typeof window !== "undefined") {
      window.location.replace(nextTarget);
    }

    if (!response.ok && response.status !== 401) {
      return {
        ok: false,
        error: data?.error?.message ?? "Signed out locally; server returned an error.",
      };
    }

    return { ok: true };
  } catch {
    clearClientAuthState();
    broadcastAuthSync(options.allSessions ? "logout_all" : "logout");
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
    return { ok: true };
  }
}
