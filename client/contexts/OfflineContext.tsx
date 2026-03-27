import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { useAuth, getNotificationPreferences } from './AuthContext';
import * as Notifications from 'expo-notifications';

const TASKS_CACHE_KEY = 'offline_tasks_cache';
const PENDING_COMPLETIONS_KEY = 'offline_pending_completions';
const SERVICE_SCHEDULES_CACHE_KEY = 'offline_service_schedules';
const SERVICE_VISITS_CACHE_KEY = 'offline_service_visits';
const PENDING_SERVICE_VISITS_KEY = 'offline_pending_service_visits';
const PENDING_ASSET_NOTES_KEY = 'offline_pending_asset_notes';

export type ServiceSchedule = {
  id: string;
  communityId: string;
  serviceType: string;
  dayOfWeek: number;
  seasonStart: string | null;
  seasonEnd: string | null;
  notes: string | null;
  isActive: boolean;
};

export type ServiceVisit = {
  id: string;
  scheduleId: string;
  communityId: string;
  serviceDate: string;
  completedAt: string | null;
  completedBy: string | null;
  employeeSignOffName: string;
  notes: string | null;
};

export type PendingServiceVisit = {
  id: string;
  scheduleId: string;
  communityId: string;
  serviceDate: string;
  employeeSignOffName: string;
  notes: string | null;
  completedAt: string;
  state: 'queued' | 'syncing' | 'synced' | 'failed';
  lastError?: string;
};

export type PendingAssetNote = {
  id: string;
  assetId: string;
  communityId: string;
  noteText: string;
  createdAt: string;
  idempotencyKey: string;
  state: 'queued' | 'syncing' | 'synced' | 'failed';
  lastError?: string;
};

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
  _dismissUnrecoverable?: boolean;
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
  cachedServiceSchedules: ServiceSchedule[];
  cachedServiceVisits: ServiceVisit[];
  pendingServiceVisits: PendingServiceVisit[];
  cacheServiceSchedules: (communityId: string, schedules: ServiceSchedule[]) => Promise<void>;
  cacheServiceVisits: (communityId: string, visits: ServiceVisit[]) => Promise<void>;
  addPendingServiceVisit: (visit: Omit<PendingServiceVisit, 'state'>) => Promise<void>;
  syncPendingServiceVisits: () => Promise<{ synced: number; failed: number }>;
  retryServiceVisit: (visitId: string) => Promise<void>;
  dismissServiceVisit: (visitId: string) => Promise<void>;
  getPendingVisitForDate: (scheduleId: string, serviceDate: string) => PendingServiceVisit | undefined;
  pendingAssetNotes: PendingAssetNote[];
  addPendingAssetNote: (note: Omit<PendingAssetNote, 'state'>) => Promise<void>;
  syncPendingAssetNotes: () => Promise<{ synced: number; failed: number }>;
  retryAssetNote: (noteId: string) => Promise<void>;
  dismissAssetNote: (noteId: string) => Promise<void>;
  getPendingNotesForAsset: (assetId: string) => PendingAssetNote[];
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
  const [cachedServiceSchedules, setCachedServiceSchedules] = useState<ServiceSchedule[]>([]);
  const [cachedServiceVisits, setCachedServiceVisits] = useState<ServiceVisit[]>([]);
  const [pendingServiceVisits, setPendingServiceVisits] = useState<PendingServiceVisit[]>([]);
  const [pendingAssetNotes, setPendingAssetNotes] = useState<PendingAssetNote[]>([]);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const syncingRef = useRef(false);
  const svcSyncingRef = useRef(false);
  const notesSyncingRef = useRef(false);
  const pendingRef = useRef(pendingCompletions);
  const pendingSvcRef = useRef(pendingServiceVisits);
  const pendingNotesRef = useRef(pendingAssetNotes);

  useEffect(() => {
    pendingRef.current = pendingCompletions;
  }, [pendingCompletions]);

  useEffect(() => {
    pendingSvcRef.current = pendingServiceVisits;
  }, [pendingServiceVisits]);

  useEffect(() => {
    pendingNotesRef.current = pendingAssetNotes;
  }, [pendingAssetNotes]);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const apiUrl = getApiUrl();
        await fetch(`${apiUrl}/api/auth/me`, { signal: controller.signal, credentials: 'include' });
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
      const hasSvcWork = pendingSvcRef.current.some(v => v.state === 'queued' || v.state === 'failed');
      if (hasSvcWork) {
        syncPendingServiceVisits();
      }
      const hasNoteWork = pendingNotesRef.current.some(n => n.state === 'queued' || n.state === 'failed');
      if (hasNoteWork) {
        syncPendingAssetNotes();
      }
    }
  }, [isOnline, user]);

  const loadCachedData = async () => {
    try {
      const [tasksJson, completionsJson, schedJson, visitsJson, pendingSvcJson, pendingNotesJson] = await Promise.all([
        AsyncStorage.getItem(TASKS_CACHE_KEY),
        AsyncStorage.getItem(PENDING_COMPLETIONS_KEY),
        AsyncStorage.getItem(SERVICE_SCHEDULES_CACHE_KEY),
        AsyncStorage.getItem(SERVICE_VISITS_CACHE_KEY),
        AsyncStorage.getItem(PENDING_SERVICE_VISITS_KEY),
        AsyncStorage.getItem(PENDING_ASSET_NOTES_KEY),
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
      if (schedJson) setCachedServiceSchedules(JSON.parse(schedJson));
      if (visitsJson) setCachedServiceVisits(JSON.parse(visitsJson));
      if (pendingSvcJson) {
        const loaded = JSON.parse(pendingSvcJson);
        const reset = loaded.map((v: PendingServiceVisit) =>
          v.state === 'syncing' ? { ...v, state: 'queued' as const } : v
        );
        setPendingServiceVisits(reset);
        pendingSvcRef.current = reset;
      }
      if (pendingNotesJson) {
        const loaded = JSON.parse(pendingNotesJson);
        const reset = loaded.map((n: PendingAssetNote) =>
          n.state === 'syncing' ? { ...n, state: 'queued' as const } : n
        );
        setPendingAssetNotes(reset);
        pendingNotesRef.current = reset;
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
        const statusMatch = e.message?.match(/^(\d+):/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

        if (statusCode === 409) {
          errorMsg = 'Version conflict — this task was modified by another user. Open the task to load the latest version, then try completing it again.';
          newState = 'conflict';
          updatedList = updateItem(updatedList, i, { state: newState, lastError: errorMsg });
          if (Platform.OS !== 'web') {
            Alert.alert(
              'Task Not Completed',
              `Your queued completion could not be submitted.\n\nReason: ${errorMsg}\n\nThe task has NOT been marked as complete.`,
              [{ text: 'OK' }],
            );
          }
          failed++;
        } else if (statusCode === 400 || statusCode === 403) {
          let reason = 'The server rejected this completion.';
          try {
            const bodyText = e.message.replace(/^\d+:\s*/, '');
            const parsed = JSON.parse(bodyText);
            if (parsed?.error) reason = parsed.error;
            else if (typeof bodyText === 'string' && bodyText.length < 200) reason = bodyText;
          } catch (_) {}

          updatedList = updateItem(updatedList, i, { state: 'failed', lastError: reason, _dismissUnrecoverable: true });

          if (Platform.OS !== 'web') {
            Alert.alert(
              'Task Not Completed',
              `Your queued completion could not be submitted.\n\nReason: ${reason}\n\nThe task has NOT been marked as complete. Please open the task and try again when the issue is resolved.`,
              [{ text: 'OK' }],
            );
          }
          failed++;
        } else if (statusCode >= 400) {
          errorMsg = e.message || 'Sync failed';
          updatedList = updateItem(updatedList, i, { state: newState, lastError: errorMsg });
          if (Platform.OS !== 'web') {
            Alert.alert(
              'Task Not Completed',
              `Your queued completion could not be submitted.\n\nReason: ${errorMsg}\n\nThe task has NOT been marked as complete. It will be retried automatically.`,
              [{ text: 'OK' }],
            );
          }
          failed++;
        } else {
          errorMsg = e.message || 'Sync failed';
          updatedList = updateItem(updatedList, i, { state: newState, lastError: errorMsg });
          failed++;
        }
      }

      setPendingCompletions([...updatedList]);
      pendingRef.current = [...updatedList];
    }

    const remaining = updatedList.filter(c => c.state !== 'synced' && !c._dismissUnrecoverable);
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

  const persistSvcQueue = async (list: PendingServiceVisit[]) => {
    await AsyncStorage.setItem(PENDING_SERVICE_VISITS_KEY, JSON.stringify(list));
  };

  const cacheServiceSchedules = useCallback(async (communityId: string, schedules: ServiceSchedule[]) => {
    try {
      await AsyncStorage.setItem(SERVICE_SCHEDULES_CACHE_KEY, JSON.stringify(schedules));
      setCachedServiceSchedules(schedules);
    } catch (e) {
      console.error('Failed to cache service schedules:', e);
    }
  }, []);

  const cacheServiceVisits = useCallback(async (communityId: string, visits: ServiceVisit[]) => {
    try {
      await AsyncStorage.setItem(SERVICE_VISITS_CACHE_KEY, JSON.stringify(visits));
      setCachedServiceVisits(visits);
    } catch (e) {
      console.error('Failed to cache service visits:', e);
    }
  }, []);

  const addPendingServiceVisit = useCallback(async (input: Omit<PendingServiceVisit, 'state'>) => {
    const visit: PendingServiceVisit = { ...input, state: 'queued' };
    const updated = [...pendingSvcRef.current, visit];
    await persistSvcQueue(updated);
    setPendingServiceVisits(updated);
    pendingSvcRef.current = updated;
  }, []);

  const syncPendingServiceVisits = useCallback(async () => {
    if (svcSyncingRef.current) return { synced: 0, failed: 0 };

    const currentQueue = [...pendingSvcRef.current];
    const toSync = currentQueue.filter(v => v.state === 'queued' || v.state === 'failed');
    if (toSync.length === 0) return { synced: 0, failed: 0 };

    svcSyncingRef.current = true;
    let synced = 0;
    let failed = 0;
    let updatedList = [...currentQueue];

    for (let i = 0; i < updatedList.length; i++) {
      const visit = updatedList[i];
      if (visit.state !== 'queued' && visit.state !== 'failed') continue;

      updatedList[i] = { ...visit, state: 'syncing', lastError: undefined };
      setPendingServiceVisits([...updatedList]);
      pendingSvcRef.current = [...updatedList];

      try {
        await apiRequest('POST', `/api/service-schedules/${visit.scheduleId}/log`, {
          serviceDate: visit.serviceDate,
          employeeSignOffName: visit.employeeSignOffName,
          notes: visit.notes,
          completedAt: visit.completedAt,
        });
        updatedList[i] = { ...updatedList[i], state: 'synced' };
        synced++;
      } catch (e: any) {
        updatedList[i] = { ...updatedList[i], state: 'failed', lastError: e.message || 'Sync failed' };
        failed++;
      }

      setPendingServiceVisits([...updatedList]);
      pendingSvcRef.current = [...updatedList];
    }

    const remaining = updatedList.filter(v => v.state !== 'synced');
    await persistSvcQueue(remaining);
    setPendingServiceVisits(remaining);
    pendingSvcRef.current = remaining;
    svcSyncingRef.current = false;

    if (synced > 0) {
      queryClient.invalidateQueries({ queryKey: ['service-visits'] });
      queryClient.invalidateQueries({ queryKey: ['service-schedules'] });
    }

    return { synced, failed };
  }, [queryClient]);

  const retryServiceVisit = useCallback(async (visitId: string) => {
    const updated = pendingSvcRef.current.map(v =>
      v.id === visitId ? { ...v, state: 'queued' as const, lastError: undefined } : v
    );
    await persistSvcQueue(updated);
    setPendingServiceVisits(updated);
    pendingSvcRef.current = updated;
    syncPendingServiceVisits();
  }, [syncPendingServiceVisits]);

  const dismissServiceVisit = useCallback(async (visitId: string) => {
    const updated = pendingSvcRef.current.filter(v => v.id !== visitId);
    await persistSvcQueue(updated);
    setPendingServiceVisits(updated);
    pendingSvcRef.current = updated;
  }, []);

  const getPendingVisitForDate = useCallback((scheduleId: string, serviceDate: string) => {
    return pendingSvcRef.current.find(v =>
      v.scheduleId === scheduleId && v.serviceDate === serviceDate && v.state !== 'synced'
    );
  }, [pendingServiceVisits]);

  const persistNotesQueue = async (list: PendingAssetNote[]) => {
    await AsyncStorage.setItem(PENDING_ASSET_NOTES_KEY, JSON.stringify(list));
  };

  const addPendingAssetNote = useCallback(async (input: Omit<PendingAssetNote, 'state'>) => {
    const note: PendingAssetNote = { ...input, state: 'queued' };
    const updated = [...pendingNotesRef.current, note];
    await persistNotesQueue(updated);
    setPendingAssetNotes(updated);
    pendingNotesRef.current = updated;
  }, []);

  const syncPendingAssetNotes = useCallback(async () => {
    if (notesSyncingRef.current) return { synced: 0, failed: 0 };
    const currentQueue = [...pendingNotesRef.current];
    const toSync = currentQueue.filter(n => n.state === 'queued' || n.state === 'failed');
    if (toSync.length === 0) return { synced: 0, failed: 0 };

    notesSyncingRef.current = true;
    let synced = 0;
    let failed = 0;
    let updatedList = [...currentQueue];

    for (let i = 0; i < updatedList.length; i++) {
      const note = updatedList[i];
      if (note.state !== 'queued' && note.state !== 'failed') continue;

      updatedList[i] = { ...note, state: 'syncing', lastError: undefined };
      setPendingAssetNotes([...updatedList]);
      pendingNotesRef.current = [...updatedList];

      try {
        await apiRequest('POST', `/api/assets/${note.assetId}/notes`, {
          noteText: note.noteText,
          idempotencyKey: note.idempotencyKey,
        });
        updatedList[i] = { ...updatedList[i], state: 'synced' };
        synced++;
      } catch (e: any) {
        updatedList[i] = { ...updatedList[i], state: 'failed', lastError: e.message || 'Sync failed' };
        failed++;
      }

      setPendingAssetNotes([...updatedList]);
      pendingNotesRef.current = [...updatedList];
    }

    const remaining = updatedList.filter(n => n.state !== 'synced');
    await persistNotesQueue(remaining);
    setPendingAssetNotes(remaining);
    pendingNotesRef.current = remaining;
    notesSyncingRef.current = false;

    if (synced > 0) {
      const assetIds = new Set(currentQueue.filter(n => n.state === 'queued' || n.state === 'failed').map(n => n.assetId));
      assetIds.forEach(aid => queryClient.invalidateQueries({ queryKey: [`/api/assets/${aid}/notes`] }));
    }

    return { synced, failed };
  }, [queryClient]);

  const retryAssetNote = useCallback(async (noteId: string) => {
    const updated = pendingNotesRef.current.map(n =>
      n.id === noteId ? { ...n, state: 'queued' as const, lastError: undefined } : n
    );
    await persistNotesQueue(updated);
    setPendingAssetNotes(updated);
    pendingNotesRef.current = updated;
    syncPendingAssetNotes();
  }, [syncPendingAssetNotes]);

  const dismissAssetNote = useCallback(async (noteId: string) => {
    const updated = pendingNotesRef.current.filter(n => n.id !== noteId);
    await persistNotesQueue(updated);
    setPendingAssetNotes(updated);
    pendingNotesRef.current = updated;
  }, []);

  const getPendingNotesForAsset = useCallback((assetId: string) => {
    return pendingNotesRef.current.filter(n => n.assetId === assetId && n.state !== 'synced');
  }, [pendingAssetNotes]);

  const clearCache = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(TASKS_CACHE_KEY),
      AsyncStorage.removeItem(PENDING_COMPLETIONS_KEY),
      AsyncStorage.removeItem(SERVICE_SCHEDULES_CACHE_KEY),
      AsyncStorage.removeItem(SERVICE_VISITS_CACHE_KEY),
      AsyncStorage.removeItem(PENDING_SERVICE_VISITS_KEY),
      AsyncStorage.removeItem(PENDING_ASSET_NOTES_KEY),
    ]);
    setCachedTasks([]);
    setPendingCompletions([]);
    pendingRef.current = [];
    setCachedServiceSchedules([]);
    setCachedServiceVisits([]);
    setPendingServiceVisits([]);
    pendingSvcRef.current = [];
    setPendingAssetNotes([]);
    pendingNotesRef.current = [];
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
        cachedServiceSchedules,
        cachedServiceVisits,
        pendingServiceVisits,
        cacheServiceSchedules,
        cacheServiceVisits,
        addPendingServiceVisit,
        syncPendingServiceVisits,
        retryServiceVisit,
        dismissServiceVisit,
        getPendingVisitForDate,
        pendingAssetNotes,
        addPendingAssetNote,
        syncPendingAssetNotes,
        retryAssetNote,
        dismissAssetNote,
        getPendingNotesForAsset,
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
