import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getQueryFn } from '@/lib/query-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';

type Community = {
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
};

const CommunityContext = createContext<CommunityContextType | null>(null);

const ACTIVE_COMMUNITY_KEY = 'active_community_id';

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);

  const { data: communities = [], isLoading } = useQuery<Community[]>({
    queryKey: ['/api/communities'],
    queryFn: getQueryFn({ on401: 'returnNull' }),
    enabled: !!user,
  });

  React.useEffect(() => {
    AsyncStorage.getItem(ACTIVE_COMMUNITY_KEY).then((id) => {
      if (id) setActiveCommunityId(id);
    });
  }, []);

  React.useEffect(() => {
    if (communities.length > 0 && !activeCommunityId) {
      const first = communities[0];
      setActiveCommunityId(first.id);
      AsyncStorage.setItem(ACTIVE_COMMUNITY_KEY, first.id);
    }
  }, [communities, activeCommunityId]);

  const activeCommunity = communities.find((c) => c.id === activeCommunityId) ?? communities[0] ?? null;

  const setActiveCommunity = useCallback((c: Community) => {
    setActiveCommunityId(c.id);
    AsyncStorage.setItem(ACTIVE_COMMUNITY_KEY, c.id);
  }, []);

  return (
    <CommunityContext.Provider value={{ communities, activeCommunity, setActiveCommunity, isLoading }}>
      {children}
    </CommunityContext.Provider>
  );
}

export function useCommunity() {
  const ctx = useContext(CommunityContext);
  if (!ctx) throw new Error('useCommunity must be used within CommunityProvider');
  return ctx;
}
