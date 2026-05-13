import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

export type PendingPinEntry = {
  id: string;
  communityId: string;
  assetType: string;
  label: string;
  latitude: number;
  longitude: number;
  properties?: { key: string; value: string }[];
  photoLocalUri?: string;
  state: 'queued' | 'syncing' | 'synced' | 'failed';
  attempts: number;
  nextRetryAt?: string;
  lastError?: string;
  serverAssetId?: string;
  idempotencyKey: string;
  createdAt: string;
  syncedAt?: string;
};

export type EnqueueInput = {
  communityId: string;
  assetType: string;
  label: string;
  latitude: number;
  longitude: number;
  properties?: { key: string; value: string }[];
  photoTempUri?: string;
  idempotencyKey: string;
};

export type ListFilter = {
  communityId?: string;
  state?: PendingPinEntry['state'] | PendingPinEntry['state'][];
};

const MMKV_INSTANCE_ID = 'vrtsync-pin-queue';
const QUEUE_INDEX_KEY = 'pin_queue_index';
const PIN_QUEUE_DIR = 'pin-queue';

let _mmkv: any = null;

function getMMKV(): any {
  if (Platform.OS === 'web') return null;
  if (!_mmkv) {
    const { MMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    _mmkv = new MMKV({ id: MMKV_INSTANCE_ID });
  }
  return _mmkv;
}

function getEntryDir(entryId: string): string {
  return `${FileSystem.documentDirectory}${PIN_QUEUE_DIR}/${entryId}/`;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

function readIndex(): PendingPinEntry[] {
  const mmkv = getMMKV();
  if (!mmkv) return [];
  const json: string | undefined = mmkv.getString(QUEUE_INDEX_KEY);
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function writeIndex(entries: PendingPinEntry[]): void {
  const mmkv = getMMKV();
  if (!mmkv) return;
  mmkv.set(QUEUE_INDEX_KEY, JSON.stringify(entries));
}

export const pinCreationQueue = {
  async enqueue(input: EnqueueInput): Promise<PendingPinEntry> {
    const id = crypto.randomUUID();
    let photoLocalUri: string | undefined;

    if (input.photoTempUri) {
      const destDir = getEntryDir(id);
      await ensureDir(destDir);
      const destPath = `${destDir}photo.jpg`;
      await FileSystem.copyAsync({ from: input.photoTempUri, to: destPath });
      photoLocalUri = destPath;
    }

    const entry: PendingPinEntry = {
      id,
      communityId: input.communityId,
      assetType: input.assetType,
      label: input.label,
      latitude: input.latitude,
      longitude: input.longitude,
      properties: input.properties,
      photoLocalUri,
      state: 'queued',
      attempts: 0,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };

    const entries = readIndex();
    entries.push(entry);
    writeIndex(entries);

    return entry;
  },

  list(filter?: ListFilter): PendingPinEntry[] {
    const entries = readIndex();
    if (!filter) return entries;
    return entries.filter((e) => {
      if (filter.communityId && e.communityId !== filter.communityId) return false;
      if (filter.state !== undefined) {
        const states = Array.isArray(filter.state) ? filter.state : [filter.state];
        if (!states.includes(e.state)) return false;
      }
      return true;
    });
  },

  update(id: string, patch: Partial<PendingPinEntry>): void {
    const entries = readIndex();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    entries[idx] = { ...entries[idx], ...patch };
    writeIndex(entries);
  },

  remove(id: string): void {
    const entries = readIndex().filter((e) => e.id !== id);
    writeIndex(entries);
  },

  async clearSyncedOlderThan(ms: number): Promise<void> {
    const entries = readIndex();
    const toKeep: PendingPinEntry[] = [];
    const toDelete: PendingPinEntry[] = [];

    for (const e of entries) {
      if (e.state === 'synced' && e.syncedAt) {
        const age = Date.now() - new Date(e.syncedAt).getTime();
        if (age > ms) {
          toDelete.push(e);
          continue;
        }
      }
      toKeep.push(e);
    }

    for (const e of toDelete) {
      try {
        const dir = getEntryDir(e.id);
        const info = await FileSystem.getInfoAsync(dir);
        if (info.exists) {
          await FileSystem.deleteAsync(dir, { idempotent: true });
        }
      } catch {
      }
    }

    writeIndex(toKeep);
  },
};
