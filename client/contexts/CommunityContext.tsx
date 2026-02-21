import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
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
  const { user, bootstrapCommunities, defaultCommunityId, isLoading: authLoading } = useAuth();
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!user) {
      setActiveCommunityId(null);
      setInitialized(false);
      return;
    }

    AsyncStorage.getItem(ACTIVE_COMMUNITY_KEY).then((savedId) => {
      const isStillAllowed = savedId && bootstrapCommunities.some((c) => c.id === savedId);
      if (isStillAllowed) {
        setActiveCommunityId(savedId);
      } else if (defaultCommunityId) {
        setActiveCommunityId(defaultCommunityId);
        AsyncStorage.setItem(ACTIVE_COMMUNITY_KEY, defaultCommunityId);
      }
      setInitialized(true);
    });
  }, [user, bootstrapCommunities, defaultCommunityId]);

  const activeCommunity = bootstrapCommunities.find((c) => c.id === activeCommunityId) ?? bootstrapCommunities[0] ?? null;

  const setActiveCommunity = useCallback((c: Community) => {
    setActiveCommunityId(c.id);
    AsyncStorage.setItem(ACTIVE_COMMUNITY_KEY, c.id);
  }, []);

  return (
    <CommunityContext.Provider value={{
      communities: bootstrapCommunities,
      activeCommunity,
      setActiveCommunity,
      isLoading: authLoading || (!initialized && !!user),
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
