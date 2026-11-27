import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { communityKey, storageGet, storageRemove, storageSet } from "./storage";
import { isHoa, isStaff, type CommunityRef, type Me } from "./session";

export interface CommunityState {
  communities: CommunityRef[];
  ready: boolean;
  error: unknown;
  activeId: string | null;
  active: CommunityRef | null;
  fixedLabel: string | null;
  setActive: (id: string | null) => void;
  /** Persist an accessible community before leaving for /web. Returns false if not accessible. */
  persistFor: (communityId: string | null | undefined) => boolean;
  retry: () => void;
}

const Ctx = createContext<CommunityState | null>(null);

export function CommunityProvider({ me, children }: { me: Me; children: ReactNode }) {
  const role = me.user.role;
  const userId = me.user.id;
  const hoa = isHoa(role);
  const staff = isStaff(role);
  const key = communityKey(userId);

  const q = useQuery({
    queryKey: ["communities", userId],
    queryFn: ({ signal }) => api<CommunityRef[]>("/api/communities", { signal }),
  });
  const communities = useMemo(() => (Array.isArray(q.data) ? q.data : []), [q.data]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const initFor = useRef<string | null>(null);

  // Initialise only once the accessible list has loaded, so a saved key is never overwritten early.
  useEffect(() => {
    if (!q.isSuccess || initFor.current === userId) return;
    initFor.current = userId;
    setInitialized(true);
    const ids = new Set(communities.map((c) => c.id));
    if (hoa) {
      const fixed = me.user.hoaCommunityId || me.communities[0]?.id || null;
      setActiveId(fixed);
      return;
    }
    const saved = storageGet(key);
    let pick: string | null = null;
    if (saved && ids.has(saved)) pick = saved;
    else if (!staff && me.defaultCommunityId && ids.has(me.defaultCommunityId)) pick = me.defaultCommunityId;
    else if (!staff && communities.length === 1) pick = communities[0].id;
    setActiveId(pick);
    if (pick && pick !== saved) storageSet(key, pick);
    if (!pick) storageRemove(key); // Admin All communities, or stale inaccessible selection.
  }, [q.isSuccess, communities, userId, hoa, staff, key, me]);

  useEffect(() => {
    if (!initialized || !q.isSuccess || !activeId || communities.some(c => c.id === activeId)) return;
    const fallback = !staff && !hoa && communities.find(c => c.id === me.defaultCommunityId);
    setActiveId(fallback ? fallback.id : null);
    if (fallback) storageSet(key, fallback.id); else storageRemove(key);
  }, [initialized, q.isSuccess, activeId, communities, staff, hoa, me.defaultCommunityId, key]);

  const setActive = useCallback((id: string | null) => {
    if (hoa || (id && !communities.some(c => c.id === id)) || (!id && !staff)) return;
    setActiveId(id);
    if (id) storageSet(key, id); else storageRemove(key);
  }, [hoa, staff, key, communities]);

  const persistFor = useCallback((cid: string | null | undefined) => {
    if (!cid) return false;
    if (hoa) {
      const fixed = me.user.hoaCommunityId || me.communities[0]?.id;
      return !!fixed && fixed === cid && communities.some(c => c.id === cid);
    }
    if (!communities.some((c) => c.id === cid)) return false;
    storageSet(key, cid);
    return true;
  }, [hoa, staff, communities, key, me]);

  const value: CommunityState = {
    communities,
    ready: q.isSuccess && initialized,
    error: q.error,
    activeId,
    active: communities.find((c) => c.id === activeId) ?? null,
    fixedLabel: hoa ? (me.communities[0]?.name ?? null) : null,
    setActive,
    persistFor,
    retry: () => { void q.refetch(); },
  };
  return createElement(Ctx.Provider, { value }, children);
}

export function useCommunity(): CommunityState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCommunity must be used inside CommunityProvider");
  return v;
}
