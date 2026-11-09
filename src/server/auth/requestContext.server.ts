import "@tanstack/react-start/server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export interface PublicOwnerUser {
  id: string;
  email: string;
  name: string;
  roleId: "owner";
}

export interface RequestAuthContextState {
  authenticated: boolean;
  user: PublicOwnerUser | null;
  idleExpiresAt: string | null;
  expiresAt: string | null;
  leadPilotAvailable?: boolean;
  reason?:
    | "unconfigured"
    | "db_error"
    | "missing"
    | "malformed"
    | "not_found"
    | "revoked"
    | "idle_expired"
    | "absolute_expired"
    | "inactive_user"
    | "non_owner";
}

const requestAuthStorage = new AsyncLocalStorage<RequestAuthContextState>();

export function runWithRequestAuthContext<T>(
  state: RequestAuthContextState,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return requestAuthStorage.run(state, fn);
}

export function getRequestAuthContext(): RequestAuthContextState {
  return (
    requestAuthStorage.getStore() ?? {
      authenticated: false,
      user: null,
      idleExpiresAt: null,
      expiresAt: null,
      leadPilotAvailable: false,
      reason: "missing",
    }
  );
}
