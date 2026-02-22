import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { useAuth, getNotificationPreferences } from './AuthContext';
import * as Notifications from 'expo-notifications';

const TASKS_CACHE_KEY = 'offline_tasks_cache';
const PENDING_COMPLETIONS_KEY = 'offline_pending_completions';

type PhotoState = {
  uri: string;
  uploadState: 'pendingUpload' | 'uploaded' | 'failed';
  uploadURL?: string;
  lastError?: string;
};

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
  photos: PhotoState[];
  state: 'queued' | 'syncing' | 'synced' | 'failed' | 'conflict';
  serverCompletionId?: string;
  lastError?: string;
  createdAt: string;
};

type PendingCompletionInput = Omit<PendingCompletion, 'state' | 'photos' | 'serverCompletionId'> & {
  photoUris: string[];
};

type OfflineContextType = {
  isOnline: boolean;
  cachedTasks: any[];
  pendingCompletions: PendingCompletion[];
  cacheTasks: (tasks: any[]) => Promise<void>;
  addPendingCompletion: (completion: PendingCompletionInput) => Promise<void>;
  syncPendingCompletions: () => Promise<{ synced: number; failed: number }>;
  retryCompletion: (completionId: string) => Promise<void>;
  dismissCompletion: (completionId: string) => Promise<void>;
  getCompletionForTask: (taskId: string) => PendingCompletion | undefined;
  clearCache: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextType | null>(null);

async function uploadFileToStorage(photoUri: string): Promise<string> {
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

  return uploadURL;
}

async function createAttachmentRecord(
  taskId: string,
  completionId: string,
  uploadURL: string,
  idempotencyKey: string,
): Promise<void> {
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

  const updateItem = (list: PendingCompletion[], index: number, patch: Partial<PendingCompletion>): PendingCompletion[] => {
    const copy = [...list];
    copy[index] = { ...copy[index], ...patch };
    return copy;
  };

  const cacheTasks = useCallback(async (tasks: any[]) => {
    try {
      await AsyncStorage.setItem(TASKS_CACHE_KEY, JSON.stringify(tasks));
      setCachedTasks(tasks);
    } catch (e) {
      console.error('Failed to cache tasks:', e);
    }
  }, []);

  const addPendingCompletion = useCallback(async (input: PendingCompletionInput) => {
    const { photoUris, ...rest } = input;
    const completion: PendingCompletion = {
      ...rest,
      photos: photoUris.map(uri => ({ uri, uploadState: 'pendingUpload' as const })),
      state: 'queued',
    };
    const updated = [...pendingRef.current, completion];
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
    let updatedList = [...currentQueue];

    for (let i = 0; i < updatedList.length; i++) {
      const completion = updatedList[i];
      if (completion.state !== 'queued' && completion.state !== 'failed') continue;

      updatedList = updateItem(updatedList, i, { state: 'syncing', lastError: undefined });
      setPendingCompletions([...updatedList]);
      pendingRef.current = [...updatedList];

      try {
        let serverCompletionId = completion.serverCompletionId;

        if (!serverCompletionId) {
          const res = await apiRequest('POST', `/api/tasks/${completion.taskId}/complete`, {
            version: completion.version,
            notes: completion.notes,
            employeeSignOffName: completion.employeeSignOffName,
            timeSpentMinutes: completion.timeSpentMinutes,
            materialsUsed: completion.materialsUsed,
            followUpNeeded: completion.followUpNeeded,
          });
          const { completion: serverCompletion } = await res.json();
          serverCompletionId = serverCompletion?.id;
          updatedList = updateItem(updatedList, i, { serverCompletionId });
          await persistQueue(updatedList);
        }

        if (completion.photos.length > 0 && serverCompletionId) {
          const updatedPhotos = [...updatedList[i].photos];
          let allUploaded = true;

          for (let p = 0; p < updatedPhotos.length; p++) {
            const photo = updatedPhotos[p];
            const idempotencyKey = `${completion.id}-photo-${p}`;

            if (photo.uploadState === 'uploaded') continue;

            let uploadURL = photo.uploadURL;

            if (!uploadURL) {
              let fileUploaded = false;
              for (let attempt = 0; attempt < 3 && !fileUploaded; attempt++) {
                try {
                  uploadURL = await uploadFileToStorage(photo.uri);
                  fileUploaded = true;
                } catch (err: any) {
                  if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                  if (!fileUploaded && attempt === 2) {
                    updatedPhotos[p] = { ...photo, uploadState: 'failed', lastError: err.message || 'Upload failed' };
                    allUploaded = false;
                  }
                }
              }
              if (!fileUploaded) continue;
            }

            let metadataCreated = false;
            for (let attempt = 0; attempt < 3 && !metadataCreated; attempt++) {
              try {
                await createAttachmentRecord(completion.taskId, serverCompletionId!, uploadURL!, idempotencyKey);
                metadataCreated = true;
              } catch (err: any) {
                if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                if (!metadataCreated && attempt === 2) {
                  updatedPhotos[p] = { ...photo, uploadState: 'failed', uploadURL, lastError: err.message || 'Metadata failed' };
                  allUploaded = false;
                }
              }
            }

            if (metadataCreated) {
              updatedPhotos[p] = { ...photo, uploadState: 'uploaded', uploadURL, lastError: undefined };
            }
          }

          updatedList = updateItem(updatedList, i, { photos: updatedPhotos });
          await persistQueue(updatedList);

          if (!allUploaded) {
            const failedCount = updatedPhotos.filter(ph => ph.uploadState === 'failed').length;
            updatedList = updateItem(updatedList, i, {
              state: 'failed',
              lastError: `${failedCount} photo(s) failed to upload`,
            });
            setPendingCompletions([...updatedList]);
            pendingRef.current = [...updatedList];
            failed++;
            continue;
          }
        }

        updatedList = updateItem(updatedList, i, { state: 'synced' });
        synced++;
      } catch (e: any) {
        let errorMsg: string;
        let newState: 'failed' | 'conflict' = 'failed';
        if (e.message?.includes('409')) {
          errorMsg = 'Version conflict — task was modified by another user. Open the task to get the latest version, then retry.';
          newState = 'conflict';
        } else {
          errorMsg = e.message || 'Sync failed';
        }
        updatedList = updateItem(updatedList, i, { state: newState, lastError: errorMsg });
        failed++;
      }

      setPendingCompletions([...updatedList]);
      pendingRef.current = [...updatedList];
    }

    const remaining = updatedList.filter(c => c.state !== 'synced');
    await persistQueue(remaining);
    setPendingCompletions(remaining);
    pendingRef.current = remaining;
    syncingRef.current = false;

    if (synced > 0) {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    }

    if (failed > 0 && Platform.OS !== 'web') {
      getNotificationPreferences().then(prefs => {
        if (prefs.syncFailure) {
          Notifications.scheduleNotificationAsync({
            content: {
              title: 'Sync failed',
              body: `${failed} completion${failed > 1 ? 's' : ''} failed to sync. Tap to review.`,
              data: { type: 'sync_failed' },
            },
            trigger: null,
          }).catch(() => {});
        }
      });
    }

    return { synced, failed };
  }, [queryClient]);

  const retryCompletion = useCallback(async (completionId: string) => {
    const updated = pendingRef.current.map(c =>
      c.id === completionId ? {
        ...c,
        state: 'queued' as const,
        lastError: undefined,
        photos: c.photos.map(p => p.uploadState === 'failed' ? { ...p, uploadState: 'pendingUpload' as const, lastError: undefined } : p),
      } : c
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
