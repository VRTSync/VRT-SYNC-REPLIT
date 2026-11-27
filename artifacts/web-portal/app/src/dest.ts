import { isStaff, webBase } from "./session";

const enc = encodeURIComponent;

export function taskHref(role: string, taskId: string, communityId: string | null | undefined): string | null {
  if (isStaff(role)) {
    if (!communityId) return null;
    return "/web/admin/community/" + enc(communityId) + "/tasks?task=" + enc(taskId);
  }
  return webBase(role) + "/tasks?task=" + enc(taskId);
}

export function assetHref(role: string, communityId: string | null | undefined): string | null {
  if (isStaff(role)) {
    if (!communityId) return null;
    return "/web/admin/community/" + enc(communityId);
  }
  return webBase(role) + "/map";
}
