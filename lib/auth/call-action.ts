// Client-side wrapper for the auth server actions. A server action can reject
// (network drop, server error, deploy mid-request) instead of returning
// { ok: false }; without this the auth screens stay on their spinner forever.

export const ACTION_FAILED = "Couldn’t reach the server. Check your connection and try again.";

/** Run `call` with `setLoading` on for its duration. If it throws, report
 *  ACTION_FAILED through `onError` and resolve to undefined. */
export async function callAction<T>(
  call: () => Promise<T>,
  onError: (msg: string) => void,
  setLoading?: (on: boolean) => void,
): Promise<T | undefined> {
  setLoading?.(true);
  try {
    return await call();
  } catch (e) {
    console.error("[auth] server action failed:", e);
    onError(ACTION_FAILED);
    return undefined;
  } finally {
    setLoading?.(false);
  }
}
