import React, { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const PUSH_TOKEN_KEY = 'push_token';
const DEVICE_ID_KEY = 'device_id';
const NOTIF_PREFS_KEY = 'notification_preferences';
const PUSH_TOKEN_LAST_REG_KEY = 'push_token_last_reg';
const PUSH_TOKEN_CLIENT_THROTTLE_MS = 86_400_000; // 24 hours — matches server rate limit

export type NotificationPreferences = {
  taskAssigned: boolean;
  dueReminders: boolean;
  syncFailure: boolean;
};

const DEFAULT_PREFS: NotificationPreferences = {
  taskAssigned: true,
  dueReminders: true,
  syncFailure: true,
};

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const res = await apiRequest('GET', '/api/notification-preferences');
    if (res.ok) {
      const serverPrefs = await res.json() as Partial<NotificationPreferences>;
      const merged = { ...DEFAULT_PREFS, ...serverPrefs };
      await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(merged));
      return merged;
    }
  } catch {}
  try {
    const json = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    if (json) return { ...DEFAULT_PREFS, ...JSON.parse(json) };
  } catch {}
  return { ...DEFAULT_PREFS };
}

export async function setNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
  try {
    const res = await apiRequest('PUT', '/api/notification-preferences', prefs);
    if (res.ok) {
      await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
      return;
    }
  } catch {}
  await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

async function getOrCreateDeviceId(): Promise<string> {
  let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

type User = {
  id: string;
  username: string;
  displayName: string;
  role: 'contractor' | 'admin' | 'hoa_admin' | 'hoa_member';
  hoaCommunityId?: string | null;
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
    const prefs = await getNotificationPreferences();
    if (!prefs.taskAssigned && !prefs.dueReminders) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Client-side 24-hour throttle: skip the API call if the same token was registered recently.
    // If the token rotated, bypass the throttle to ensure the new token is registered.
    const lastRegStr = await AsyncStorage.getItem(PUSH_TOKEN_LAST_REG_KEY);
    if (lastRegStr) {
      try {
        const { ts, token: lastToken } = JSON.parse(lastRegStr) as { ts: number; token: string };
        if (lastToken === token && Date.now() - ts < PUSH_TOKEN_CLIENT_THROTTLE_MS) {
          return;
        }
      } catch {}
    }

    const platform = Platform.OS as 'ios' | 'android';
    const deviceId = await getOrCreateDeviceId();

    const regRes = await apiRequest('POST', '/api/push-tokens', { token, platform, deviceId });
    const regData = await regRes.json() as { rateLimited?: boolean };
    if (regData.rateLimited) {
      // Server already has this same token registered. Persist throttle so the client
      // stops calling for the next 24h without needing another round trip.
      await AsyncStorage.setItem(PUSH_TOKEN_LAST_REG_KEY, JSON.stringify({ ts: Date.now(), token }));
      return;
    }
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    await AsyncStorage.setItem(PUSH_TOKEN_LAST_REG_KEY, JSON.stringify({ ts: Date.now(), token }));
  } catch (e) {
    console.warn('Push token registration failed:', e);
  }
}

async function unregisterPushToken() {
  if (Platform.OS === 'web') return;
  try {
    const deviceId = await getOrCreateDeviceId();
    await apiRequest('DELETE', '/api/push-tokens', { deviceId });
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
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
  const userId = user?.id ?? null;

  useEffect(() => {
    if (userId && !pushTokenRegistered.current) {
      pushTokenRegistered.current = true;
      registerPushTokenWithServer();
    }
    if (!userId) {
      pushTokenRegistered.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!userId) return;
    const subscription = Notifications.addPushTokenListener(() => {
      if (!pushTokenRegistered.current) return;
      registerPushTokenWithServer();
    });
    return () => subscription.remove();
  }, [userId]);

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
      queryClient.clear();
      try {
        await AsyncStorage.removeItem('vrt-sync-rq-cache');
      } catch {}
      try {
        await AsyncStorage.removeItem(PUSH_TOKEN_LAST_REG_KEY);
      } catch {}
      let deviceId: string | undefined;
      try {
        deviceId = await getOrCreateDeviceId();
      } catch {}
      try {
        await unregisterPushToken();
      } catch {}
      try {
        await apiRequest('POST', '/api/auth/logout', deviceId ? { deviceId } : undefined);
      } catch {}
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
