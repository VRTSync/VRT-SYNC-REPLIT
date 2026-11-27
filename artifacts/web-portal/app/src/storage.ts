export function storageGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function storageSet(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}
export function storageRemove(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
/** Same key the /web portal uses. */
export function communityKey(userId: string): string {
  return "vrtsync_community_" + userId;
}
