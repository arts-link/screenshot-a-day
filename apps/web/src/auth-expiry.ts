export const AUTH_EXPIRED_EVENT = "sad-auth-expired";
export const AUTH_EXPIRED_MESSAGE =
  "Your administrator session has expired or was revoked. Sign in again to continue.";

export interface AuthRedirectLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface AuthRedirectState {
  from: AuthRedirectLocation;
  message: string;
}

export function redirectAfterSessionExpiry(
  navigate: (path: string, options: { replace: boolean; state: AuthRedirectState }) => void,
  clear: () => void,
  from: AuthRedirectLocation,
): void {
  clear();
  navigate("/login", {
    replace: true,
    state: { from, message: AUTH_EXPIRED_MESSAGE },
  });
}

export function authMessageFromState(state: unknown): string | undefined {
  if (
    typeof state === "object" &&
    state !== null &&
    "message" in state &&
    typeof state.message === "string"
  )
    return state.message;
  return undefined;
}
