import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import { useAuth } from './AuthContext';

const TASKS_CACHE_KEY = 'offline_tasks_cache';
const PENDING_COMPLETIONS_KEY = 'offline_pending_completions';

type PendingCompletion = {
  id: string;
  taskId: string;
  version: number;
  notes?: string;
  photoUris: string[];
  createdAt: string;
};

type OfflineContextType = {
  isOnline: boolean;
  cachedTasks: any[];
  pendingCompletions: PendingCompletion[];
  cacheTasks: (tasks: any[]) => Promise<void>;
  addPendingCompletion: (completion: PendingCompletion) => Promise<void>;
  syncPendingCompletions: () => Promise<{ synced: number; failed: number }>;
  clearCache: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextType | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [cachedTasks, setCachedTasks] = useState<any[]>([]);
  const [pendingCompletions, setPendingCompletions] = useState<PendingCompletion[]>([]);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const syncingRef = useRef(false);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch('/api/auth/me', { signal: controller.signal, credentials: 'include' });
        clearTimeout(timeout);
        setIsOnline(true);
      } catch {
        setIsOnline(false);
      }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadCachedData();
  }, []);

  useEffect(() => {
    if (isOnline && pendingCompletions.length > 0 && user) {
      syncPendingCompletions();
    }
  }, [isOnline, user]);

  const loadCachedData = async () => {
    try {
      const [tasksJson, completionsJson] = await Promise.all([
        AsyncStorage.getItem(TASKS_CACHE_KEY),
        AsyncStorage.getItem(PENDING_COMPLETIONS_KEY),
      ]);
      if (tasksJson) setCachedTasks(JSON.parse(tasksJson));
      if (completionsJson) setPendingCompletions(JSON.parse(completionsJson));
    } catch (e) {
      console.error('Failed to load offline cache:', e);
    }
  };

  const cacheTasks = useCallback(async (tasks: any[]) => {
    try {
      await AsyncStorage.setItem(TASKS_CACHE_KEY, JSON.stringify(tasks));
      setCachedTasks(tasks);
    } catch (e) {
      console.error('Failed to cache tasks:', e);
    }
  }, []);

  const addPendingCompletion = useCallback(async (completion: PendingCompletion) => {
    const updated = [...pendingCompletions, completion];
    await AsyncStorage.setItem(PENDING_COMPLETIONS_KEY, JSON.stringify(updated));
    setPendingCompletions(updated);
  }, [pendingCompletions]);

  const syncPendingCompletions = useCallback(async () => {
    if (syncingRef.current || pendingCompletions.length === 0) {
      return { synced: 0, failed: 0 };
    }
    syncingRef.current = true;

    let synced = 0;
    let failed = 0;
    const remaining: PendingCompletion[] = [];

    for (const completion of pendingCompletions) {
      try {
        await apiRequest('POST', `/api/tasks/${completion.taskId}/complete`, {
          version: completion.version,
          notes: completion.notes,
        });
        synced++;
      } catch (e: any) {
        if (e.message?.includes('409')) {
          failed++;
        } else {
          remaining.push(completion);
          failed++;
        }
      }
    }

    await AsyncStorage.setItem(PENDING_COMPLETIONS_KEY, JSON.stringify(remaining));
    setPendingCompletions(remaining);
    syncingRef.current = false;

    if (synced > 0) {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    }

    return { synced, failed };
  }, [pendingCompletions, queryClient]);

  const clearCache = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(TASKS_CACHE_KEY),
      AsyncStorage.removeItem(PENDING_COMPLETIONS_KEY),
    ]);
    setCachedTasks([]);
    setPendingCompletions([]);
  }, []);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        cachedTasks,
        pendingCompletions,
        cacheTasks,
        addPendingCompletion,
        syncPendingCompletions,
        clearCache,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
