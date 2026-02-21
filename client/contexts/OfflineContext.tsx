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
  employeeSignOffName: string;
  timeSpentMinutes?: number;
  materialsUsed?: string;
  followUpNeeded?: string;
  photoUris: string[];
  createdAt: string;
  state: 'queued' | 'syncing' | 'synced' | 'failed';
  errorMessage?: string;
};

type OfflineContextType = {
  isOnline: boolean;
  cachedTasks: any[];
  pendingCompletions: PendingCompletion[];
  cacheTasks: (tasks: any[]) => Promise<void>;
  addPendingCompletion: (completion: Omit<PendingCompletion, 'state'>) => Promise<void>;
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

  const addPendingCompletion = useCallback(async (completion: Omit<PendingCompletion, 'state'>) => {
    const withState: PendingCompletion = { ...completion, state: 'queued' };
    const updated = [...pendingCompletions, withState];
    await AsyncStorage.setItem(PENDING_COMPLETIONS_KEY, JSON.stringify(updated));
    setPendingCompletions(updated);
  }, [pendingCompletions]);

  const syncPendingCompletions = useCallback(async () => {
    if (syncingRef.current) {
      return { synced: 0, failed: 0 };
    }
    const toSync = pendingCompletions.filter(c => c.state === 'queued' || c.state === 'failed');
    if (toSync.length === 0) {
      return { synced: 0, failed: 0 };
    }
    syncingRef.current = true;

    let synced = 0;
    let failed = 0;
    const updatedList = [...pendingCompletions];

    for (let i = 0; i < updatedList.length; i++) {
      const completion = updatedList[i];
      if (completion.state !== 'queued' && completion.state !== 'failed') continue;

      updatedList[i] = { ...completion, state: 'syncing' };
      setPendingCompletions([...updatedList]);

      try {
        await apiRequest('POST', `/api/tasks/${completion.taskId}/complete`, {
          version: completion.version,
          notes: completion.notes,
          employeeSignOffName: completion.employeeSignOffName,
          timeSpentMinutes: completion.timeSpentMinutes,
          materialsUsed: completion.materialsUsed,
          followUpNeeded: completion.followUpNeeded,
        });
        updatedList[i] = { ...completion, state: 'synced' };
        synced++;
      } catch (e: any) {
        const errorMsg = e.message?.includes('409')
          ? 'Version conflict — task was modified by another user'
          : (e.message || 'Sync failed');
        updatedList[i] = { ...completion, state: 'failed', errorMessage: errorMsg };
        failed++;
      }
    }

    const remaining = updatedList.filter(c => c.state !== 'synced');
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
