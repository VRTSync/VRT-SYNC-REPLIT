import React, { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_TOKEN_KEY = 'push_token';

type User = {
  id: string;
  username: string;
  displayName: string;
  role: 'contractor' | 'admin';
};

type Community = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

type BootstrapPayload = {
  user: User;
  communities: Community[];
  defaultCommunityId: string | null;
};

type AuthContextType = {
  user: User | null;
  bootstrapCommunities: Community[];
  defaultCommunityId: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string, role: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

async function registerPushTokenWithServer() {
  if (Platform.OS === 'web') return;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    const platform = Platform.OS as 'ios' | 'android';

    await apiRequest('POST', '/api/push-tokens', { token, platform });
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch (e) {
    console.warn('Push token registration failed:', e);
  }
}

async function unregisterPushToken() {
  if (Platform.OS === 'web') return;
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) {
      await apiRequest('DELETE', '/api/push-tokens', { token });
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    }
  } catch (e) {
    console.warn('Push token removal failed:', e);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const pushTokenRegistered = useRef(false);

  const { data: bootstrap, isLoading } = useQuery<BootstrapPayload | null>({
    queryKey: ['/api/auth/me'],
    queryFn: getQueryFn({ on401: 'returnNull' }),
    staleTime: Infinity,
  });

  const user = bootstrap?.user ?? null;
  const bootstrapCommunities = bootstrap?.communities ?? [];
  const defaultCommunityId = bootstrap?.defaultCommunityId ?? null;

  useEffect(() => {
    if (user && !pushTokenRegistered.current) {
      pushTokenRegistered.current = true;
      registerPushTokenWithServer();
    }
    if (!user) {
      pushTokenRegistered.current = false;
    }
  }, [user]);

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await apiRequest('POST', '/api/auth/login', { username, password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; displayName: string; role: string }) => {
      const res = await apiRequest('POST', '/api/auth/register', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await unregisterPushToken();
      await apiRequest('POST', '/api/auth/logout');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      queryClient.clear();
    },
  });

  const login = useCallback(async (username: string, password: string) => {
    await loginMutation.mutateAsync({ username, password });
  }, [loginMutation]);

  const register = useCallback(async (username: string, password: string, displayName: string, role: string) => {
    await registerMutation.mutateAsync({ username, password, displayName, role });
  }, [registerMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  return (
    <AuthContext.Provider value={{ user, bootstrapCommunities, defaultCommunityId, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
