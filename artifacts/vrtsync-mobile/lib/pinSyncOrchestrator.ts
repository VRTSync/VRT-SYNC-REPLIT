import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { pinCreationQueue, type PendingPinEntry } from './pinCreationQueue';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import type { QueryClient } from '@tanstack/react-query';

const BACKOFF_WINDOWS_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000, 24 * 60 * 60_000];

function getBackoffWindow(attemptsIndex: number): number {
  const idx = Math.min(attemptsIndex, BACKOFF_WINDOWS_MS.length - 1);
  return BACKOFF_WINDOWS_MS[idx];
}

function isEligibleForRetry(entry: PendingPinEntry, ignoreBackoff = false): boolean {
  if (entry.state === 'queued') return true;
  if (entry.state === 'failed') {
    if (ignoreBackoff || !entry.nextRetryAt) return true;
    return Date.now() >= new Date(entry.nextRetryAt).getTime();
  }
  return false;
}

async function uploadPhotoForEntry(photoLocalUri: string): Promise<string> {
  const apiUrl = getApiUrl();
  const presignRes = await fetch(`${apiUrl}/api/objects/upload`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!presignRes.ok) throw new Error('Failed to get upload URL');
  const { uploadURL } = await presignRes.json();

  if (Platform.OS === 'web') {
    const blob = await fetch(photoLocalUri).then((r) => r.blob());
    const uploadRes = await fetch(uploadURL, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
    });
    if (!uploadRes.ok) throw new Error('Photo upload failed');
  } else {
    const result = await FileSystem.uploadAsync(uploadURL, photoLocalUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Photo upload failed: ${result.status}`);
    }
  }

  return uploadURL;
}

async function deleteEntryPhotoDir(entryId: string): Promise<void> {
  try {
    const dir = `${FileSystem.documentDirectory}pin-queue/${entryId}/`;
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }
  } catch {
  }
}

class PinSyncOrchestrator {
  private isRunning = false;
  private _queryClient: QueryClient | null = null;

  setQueryClient(qc: QueryClient) {
    this._queryClient = qc;
  }

  async run(opts?: { entryId?: string; ignoreBackoff?: boolean }): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const all = pinCreationQueue.list();
      const toProcess = all.filter((e) => {
        if (opts?.entryId && e.id !== opts.entryId) return false;
        return isEligibleForRetry(e, opts?.ignoreBackoff);
      });

      for (const entry of toProcess) {
        await this._syncEntry(entry);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async _syncEntry(entry: PendingPinEntry): Promise<void> {
    pinCreationQueue.update(entry.id, { state: 'syncing' });

    try {
      let serverAssetId = entry.serverAssetId;

      if (!serverAssetId) {
        const res = await apiRequest('POST', '/api/assets', {
          communityId: entry.communityId,
          assetType: entry.assetType,
          label: entry.label,
          latitude: entry.latitude,
          longitude: entry.longitude,
          idempotencyKey: entry.idempotencyKey,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Asset creation failed: ${res.status} ${body}`);
        }
        const asset = await res.json();
        serverAssetId = asset.id as string;
        pinCreationQueue.update(entry.id, { serverAssetId });
      }

      if (entry.photoLocalUri) {
        const uploadURL = await uploadPhotoForEntry(entry.photoLocalUri);
        await apiRequest('POST', `/api/assets/${serverAssetId}/attachments`, {
          uploadURL,
          idempotencyKey: entry.idempotencyKey + '_photo',
        });
        await deleteEntryPhotoDir(entry.id);
      }

      if (this._queryClient && serverAssetId) {
        try {
          const cacheKey = ['/api/communities', entry.communityId, 'assets'];
          const existing = this._queryClient.getQueryData<any[]>(cacheKey) ?? [];
          const withoutPending = existing.filter(
            (a) => a.id !== `pending-${entry.idempotencyKey}`,
          );
          this._queryClient.setQueryData(cacheKey, [
            ...withoutPending,
            {
              id: serverAssetId,
              communityId: entry.communityId,
              assetType: entry.assetType,
              label: entry.label,
              latitude: entry.latitude,
              longitude: entry.longitude,
              isArchived: false,
              pending: false,
            },
          ]);
        } catch {
        }
      }

      pinCreationQueue.update(entry.id, {
        state: 'synced',
        syncedAt: new Date().toISOString(),
        lastError: undefined,
        serverAssetId,
      });
    } catch (err: unknown) {
      const attempts = (entry.attempts ?? 0) + 1;
      const backoff = getBackoffWindow(attempts - 1);
      const nextRetryAt = new Date(Date.now() + backoff).toISOString();
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      pinCreationQueue.update(entry.id, {
        state: 'failed',
        attempts,
        nextRetryAt,
        lastError: errorMsg,
      });
    }
  }
}

export const pinSyncOrchestrator = new PinSyncOrchestrator();
