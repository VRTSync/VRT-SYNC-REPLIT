import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { useAuth } from './AuthContext';

const TASKS_CACHE_KEY = 'offline_tasks_cache';
const PENDING_COMPLETIONS_KEY = 'offline_pending_completions';

type PendingCompletion = {
  id: string;
  taskId: string;
  version: number;
  notes?: string;
  employeeSignOffName: string;
  completedAt: string;
  timeSpentMinutes?: number;
  materialsUsed?: string;
  followUpNeeded?: string;
  photoUris: string[];
  state: 'queued' | 'syncing' | 'synced' | 'failed';
  lastError?: string;
  createdAt: string;
};

type OfflineContextType = {
  isOnline: boolean;
  cachedTasks: any[];
  pendingCompletions: PendingCompletion[];
  cacheTasks: (tasks: any[]) => Promise<void>;
  addPendingCompletion: (completion: Omit<PendingCompletion, 'state'>) => Promise<void>;
  syncPendingCompletions: () => Promise<{ synced: number; failed: number }>;
  retryCompletion: (completionId: string) => Promise<void>;
  dismissCompletion: (completionId: string) => Promise<void>;
  getCompletionForTask: (taskId: string) => PendingCompletion | undefined;
  clearCache: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextType | null>(null);

async function uploadPhotoAndAttach(
  taskId: string,
  completionId: string,
  photoUri: string,
  idempotencyKey: string,
): Promise<void> {
  const apiUrl = getApiUrl();

  const presignRes = await fetch(`${apiUrl}/api/objects/upload`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!presignRes.ok) throw new Error('Failed to get upload URL');
  const { uploadURL } = await presignRes.json();

  if (Platform.OS === 'web') {
    const blob = await fetch(photoUri).then(r => r.blob());
    const uploadRes = await fetch(uploadURL, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
    });
    if (!uploadRes.ok) throw new Error('Photo upload failed');
  } else {
    const { File } = await import('expo-file-system');
    const { fetch: expoFetch } = await import('expo/fetch');
    const file = new File(photoUri);
    const uploadRes = await expoFetch(uploadURL, {
      method: 'PUT',
      body: file as any,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    if (!uploadRes.ok) throw new Error('Photo upload failed');
  }

  await apiRequest('POST', `/api/tasks/${taskId}/attachments`, {
    taskCompletionId: completionId,
    uploadURL,
    idempotencyKey,
  });
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [cachedTasks, setCachedTasks] = useState<any[]>([]);
  const [pendingCompletions, setPendingCompletions] = useState<PendingCompletion[]>([]);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const syncingRef = useRef(false);
  const pendingRef = useRef(pendingCompletions);

  useEffect(() => {
    pendingRef.current = pendingCompletions;
  }, [pendingCompletions]);

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
    if (isOnline && user) {
      const hasWork = pendingRef.current.some(c => c.state === 'queued' || c.state === 'failed');
      if (hasWork) {
        syncPendingCompletions();
      }
    }
  }, [isOnline, user]);

  const loadCachedData = async () => {
    try {
      const [tasksJson, completionsJson] = await Promise.all([
        AsyncStorage.getItem(TASKS_CACHE_KEY),
        AsyncStorage.getItem(PENDING_COMPLETIONS_KEY),
      ]);
      if (tasksJson) setCachedTasks(JSON.parse(tasksJson));
      if (completionsJson) {
        const loaded = JSON.parse(completionsJson);
        const resetSyncing = loaded.map((c: PendingCompletion) =>
          c.state === 'syncing' ? { ...c, state: 'queued' as const } : c
        );
        setPendingCompletions(resetSyncing);
        pendingRef.current = resetSyncing;
      }
    } catch (e) {
      console.error('Failed to load offline cache:', e);
    }
  };

  const persistQueue = async (list: PendingCompletion[]) => {
    await AsyncStorage.setItem(PENDING_COMPLETIONS_KEY, JSON.stringify(list));
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
    const updated = [...pendingRef.current, withState];
    await persistQueue(updated);
    setPendingCompletions(updated);
    pendingRef.current = updated;
  }, []);

  const syncPendingCompletions = useCallback(async () => {
    if (syncingRef.current) return { synced: 0, failed: 0 };

    const currentQueue = [...pendingRef.current];
    const toSync = currentQueue.filter(c => c.state === 'queued' || c.state === 'failed');
    if (toSync.length === 0) return { synced: 0, failed: 0 };

    syncingRef.current = true;
    let synced = 0;
    let failed = 0;
    const updatedList = [...currentQueue];

    for (let i = 0; i < updatedList.length; i++) {
      const completion = updatedList[i];
      if (completion.state !== 'queued' && completion.state !== 'failed') continue;

      updatedList[i] = { ...completion, state: 'syncing', lastError: undefined };
      setPendingCompletions([...updatedList]);
      pendingRef.current = [...updatedList];

      try {
        const res = await apiRequest('POST', `/api/tasks/${completion.taskId}/complete`, {
          version: completion.version,
          notes: completion.notes,
          employeeSignOffName: completion.employeeSignOffName,
          timeSpentMinutes: completion.timeSpentMinutes,
          materialsUsed: completion.materialsUsed,
          followUpNeeded: completion.followUpNeeded,
        });
        const { completion: serverCompletion } = await res.json();

        if (completion.photoUris.length > 0 && serverCompletion?.id) {
          let photoFailures = 0;
          for (const photoUri of completion.photoUris) {
            const idempotencyKey = `${completion.id}-photo-${completion.photoUris.indexOf(photoUri)}`;
            let uploaded = false;
            for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
              try {
                await uploadPhotoAndAttach(
                  completion.taskId,
                  serverCompletion.id,
                  photoUri,
                  idempotencyKey,
                );
                uploaded = true;
              } catch (uploadErr) {
                console.warn(`Photo upload attempt ${attempt + 1} failed:`, uploadErr);
                if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
              }
            }
            if (!uploaded) photoFailures++;
          }
          if (photoFailures > 0) {
            console.warn(`${photoFailures} photo(s) failed to upload for completion ${completion.id}`);
          }
        }

        updatedList[i] = { ...completion, state: 'synced' };
        synced++;
      } catch (e: any) {
        let errorMsg: string;
        if (e.message?.includes('409')) {
          errorMsg = 'Version conflict — task was modified. Refresh the task and retry.';
        } else {
          errorMsg = e.message || 'Sync failed';
        }
        updatedList[i] = { ...completion, state: 'failed', lastError: errorMsg };
        failed++;
      }
    }

    const remaining = updatedList.filter(c => c.state !== 'synced');
    await persistQueue(remaining);
    setPendingCompletions(remaining);
    pendingRef.current = remaining;
    syncingRef.current = false;

    if (synced > 0) {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    }

    return { synced, failed };
  }, [queryClient]);

  const retryCompletion = useCallback(async (completionId: string) => {
    const updated = pendingRef.current.map(c =>
      c.id === completionId ? { ...c, state: 'queued' as const, lastError: undefined } : c
    );
    await persistQueue(updated);
    setPendingCompletions(updated);
    pendingRef.current = updated;
    syncPendingCompletions();
  }, [syncPendingCompletions]);

  const dismissCompletion = useCallback(async (completionId: string) => {
    const updated = pendingRef.current.filter(c => c.id !== completionId);
    await persistQueue(updated);
    setPendingCompletions(updated);
    pendingRef.current = updated;
  }, []);

  const getCompletionForTask = useCallback((taskId: string) => {
    return pendingRef.current.find(c => c.taskId === taskId && c.state !== 'synced');
  }, [pendingCompletions]);

  const clearCache = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(TASKS_CACHE_KEY),
      AsyncStorage.removeItem(PENDING_COMPLETIONS_KEY),
    ]);
    setCachedTasks([]);
    setPendingCompletions([]);
    pendingRef.current = [];
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
        retryCompletion,
        dismissCompletion,
        getCompletionForTask,
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
