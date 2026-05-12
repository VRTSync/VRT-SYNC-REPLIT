import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { apiRequest } from '@/lib/query-client';

export type Community = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

type CommunityContextType = {
  communities: Community[];
  activeCommunity: Community | null;
  setActiveCommunity: (c: Community) => void;
  isLoading: boolean;
  isHoaUser: boolean;
  refresh: () => Promise<void>;
  addCommunityOptimistic: (c: Community) => void;
};

const CommunityContext = createContext<CommunityContextType | null>(null);

const ACTIVE_COMMUNITY_KEY = 'active_community_id';
const LIVE_COMMUNITIES_KEY = ['communities', 'live'] as const;

async function fetchLiveCommunities(): Promise<Community[]> {
  const res = await apiRequest('GET', '/api/communities');
  return res.json();
}

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { user, bootstrapCommunities, defaultCommunityId, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const isMapCreator = user?.role === 'map_creator';

  const { data: liveCommunitiesData, isLoading: liveLoading } = useQuery<Community[]>({
    queryKey: LIVE_COMMUNITIES_KEY,
    queryFn: fetchLiveCommunities,
    enabled: isMapCreator,
    staleTime: 30_000,
  });

  const communities: Community[] = isMapCreator
    ? (liveCommunitiesData ?? bootstrapCommunities)
    : bootstrapCommunities;

  useEffect(() => {
    if (!user) {
      setActiveCommunityId(null);
      setInitialized(false);
      return;
    }

    AsyncStorage.getItem(ACTIVE_COMMUNITY_KEY).then((savedId) => {
      const isStillAllowed = savedId && communities.some((c) => c.id === savedId);
      if (isStillAllowed) {
        setActiveCommunityId(savedId);
      } else if (defaultCommunityId) {
        setActiveCommunityId(defaultCommunityId);
        AsyncStorage.setItem(ACTIVE_COMMUNITY_KEY, String(defaultCommunityId));
      }
      setInitialized(true);
    });
  }, [user, bootstrapCommunities, defaultCommunityId, communities]);

  const isHoaUser = user?.role === 'hoa_admin' || user?.role === 'hoa_member';

  const activeCommunity = communities.find((c) => c.id === activeCommunityId) ?? communities[0] ?? null;

  const setActiveCommunity = useCallback((c: Community) => {
    if (!c?.id) return;
    if (isHoaUser) return;
    setActiveCommunityId(c.id);
    AsyncStorage.setItem(ACTIVE_COMMUNITY_KEY, String(c.id));
  }, [isHoaUser]);

  const refresh = useCallback(async () => {
    if (!isMapCreator) return;
    await queryClient.invalidateQueries({ queryKey: LIVE_COMMUNITIES_KEY });
  }, [isMapCreator, queryClient]);

  const addCommunityOptimistic = useCallback((c: Community) => {
    if (!isMapCreator) return;
    queryClient.setQueryData<Community[]>(LIVE_COMMUNITIES_KEY, (prev) => {
      const existing = prev ?? bootstrapCommunities;
      if (existing.some((x) => x.id === c.id)) return existing;
      return [c, ...existing];
    });
  }, [isMapCreator, queryClient, bootstrapCommunities]);

  const isLoading = authLoading
    || (!initialized && !!user)
    || (isMapCreator && liveLoading && !liveCommunitiesData);

  return (
    <CommunityContext.Provider value={{
      communities,
      activeCommunity,
      setActiveCommunity,
      isLoading,
      isHoaUser,
      refresh,
      addCommunityOptimistic,
    }}>
      {children}
    </CommunityContext.Provider>
  );
}

export function useCommunity() {
  const ctx = useContext(CommunityContext);
  if (!ctx) throw new Error('useCommunity must be used within CommunityProvider');
  return ctx;
}
