import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SearchIndexAsset = {
  id: string;
  assetType: string;
  label: string;
  featureRef: string | null;
  isArchived: boolean;
  latitude: number | null;
  longitude: number | null;
  props: Record<string, string>;
};

export type SearchIndexTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  linkedAssetLabel: string | null;
  linkedAssetType: string | null;
};

export type SearchIndex = {
  assets: SearchIndexAsset[];
  tasks: SearchIndexTask[];
};

export type PackManifest = {
  communityId: string;
  communityName: string;
  generatedAt: string;
  layers: {
    id: string;
    layerKey: string;
    subLayerKey: string;
    displayName: string;
    updatedAt: string;
  }[];
};

export type AssetIndexEntry = {
  assetId: string;
  label: string;
  assetType: string;
  properties: { key: string; value: string }[];
};

export type PackMeta = {
  communityId: string;
  packId: string;
  packVersion: number;
  downloadedAt: string;
  checksum: string | null;
  manifest: PackManifest;
  assetIndex: Record<string, AssetIndexEntry>;
  geojsonBundle: Record<string, any>;
  workHistorySnapshot: Record<string, any[]>;
  searchIndex?: SearchIndex;
};

const MMKV_KEY_PREFIX = 'pack_meta_';
const PACKS_DIR = 'offline-packs';
const WEB_STORAGE_KEY = 'offline_pack_meta_v2';
const LEGACY_STORAGE_KEY = 'offline_pack_meta';

let _mmkv: any = null;

function getMMKV(): any {
  if (Platform.OS === 'web') return null;
  if (!_mmkv) {
    const { MMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    _mmkv = new MMKV({ id: 'vrtsync-offline-packs' });
  }
  return _mmkv;
}

function getPackDir(communityId: string): string {
  return `${FileSystem.documentDirectory}${PACKS_DIR}/${communityId}/`;
}

function safeLayerId(layerId: string): string {
  return layerId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

async function readJson(path: string): Promise<any | null> {
  const info = await FileSystem.getInfoAsync(path, { size: true });
  if (!info.exists) return null;
  const sizeInfo = info as FileSystem.FileInfo & { size?: number };
  if (typeof sizeInfo.size === 'number' && sizeInfo.size === 0) return null;
  try {
    const text = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadAllPacksWeb(): Promise<Record<string, PackMeta>> {
  try {
    const json = await AsyncStorage.getItem(WEB_STORAGE_KEY);
    if (json) return JSON.parse(json);
    const legacyJson = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyJson) return JSON.parse(legacyJson);
    return {};
  } catch {
    return {};
  }
}

export async function savePack(pack: PackMeta): Promise<void> {
  if (Platform.OS === 'web') {
    const all = await loadAllPacksWeb();
    all[pack.communityId] = pack;
    await AsyncStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(all));
    return;
  }

  const mmkv = getMMKV();
  const mmkvKey = MMKV_KEY_PREFIX + pack.communityId;
  const dir = getPackDir(pack.communityId);

  mmkv.delete(mmkvKey);

  await ensureDir(dir);

  await writeJson(`${dir}assetIndex.json`, pack.assetIndex);
  await writeJson(`${dir}workHistory.json`, pack.workHistorySnapshot);

  if (pack.searchIndex) {
    await writeJson(`${dir}searchIndex.json`, pack.searchIndex);
  } else {
    const si = await FileSystem.getInfoAsync(`${dir}searchIndex.json`);
    if (si.exists) await FileSystem.deleteAsync(`${dir}searchIndex.json`, { idempotent: true });
  }

  const layerIndex: Record<string, string> = {};
  for (const layerId of Object.keys(pack.geojsonBundle)) {
    const safe = safeLayerId(layerId);
    layerIndex[layerId] = safe;
    await writeJson(`${dir}layer_${safe}.json`, pack.geojsonBundle[layerId]);
  }
  await writeJson(`${dir}layerIndex.json`, layerIndex);

  const mmkvMeta = {
    packId: pack.packId,
    packVersion: pack.packVersion,
    downloadedAt: pack.downloadedAt,
    checksum: pack.checksum,
    communityId: pack.communityId,
    manifest: pack.manifest,
  };
  mmkv.set(mmkvKey, JSON.stringify(mmkvMeta));
}

export async function loadPack(communityId: string): Promise<PackMeta | null> {
  if (Platform.OS === 'web') {
    const all = await loadAllPacksWeb();
    return all[communityId] ?? null;
  }

  const mmkv = getMMKV();
  const metaStr: string | undefined = mmkv.getString(MMKV_KEY_PREFIX + communityId);
  if (!metaStr) return null;

  let meta: { packId: string; packVersion: number; downloadedAt: string; checksum: string | null; communityId: string; manifest: PackManifest };
  try {
    meta = JSON.parse(metaStr);
  } catch {
    return null;
  }

  const dir = getPackDir(communityId);

  try {
    const [assetIndex, workHistory, layerIndex] = await Promise.all([
      readJson(`${dir}assetIndex.json`),
      readJson(`${dir}workHistory.json`),
      readJson(`${dir}layerIndex.json`),
    ]);

    if (!assetIndex || !layerIndex) return null;

    const geojsonBundle: Record<string, any> = {};
    for (const [layerId, safe] of Object.entries(layerIndex as Record<string, string>)) {
      const data = await readJson(`${dir}layer_${safe}.json`);
      if (data !== null) geojsonBundle[layerId] = data;
    }

    const searchIndex = await readJson(`${dir}searchIndex.json`);

    return {
      communityId,
      packId: meta.packId,
      packVersion: meta.packVersion,
      downloadedAt: meta.downloadedAt,
      checksum: meta.checksum ?? null,
      manifest: meta.manifest,
      assetIndex,
      geojsonBundle,
      workHistorySnapshot: workHistory ?? {},
      searchIndex: searchIndex ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function deletePack(communityId: string): Promise<void> {
  if (Platform.OS === 'web') {
    const all = await loadAllPacksWeb();
    delete all[communityId];
    await AsyncStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(all));
    return;
  }

  const mmkv = getMMKV();
  mmkv.delete(MMKV_KEY_PREFIX + communityId);

  const dir = getPackDir(communityId);
  const info = await FileSystem.getInfoAsync(dir);
  if (info.exists) {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  }
}

export async function listPackCommunityIds(): Promise<string[]> {
  if (Platform.OS === 'web') {
    const all = await loadAllPacksWeb();
    return Object.keys(all);
  }

  const mmkv = getMMKV();
  const keys: string[] = mmkv.getAllKeys();
  return keys
    .filter((k: string) => k.startsWith(MMKV_KEY_PREFIX))
    .map((k: string) => k.slice(MMKV_KEY_PREFIX.length));
}

export type PackVerifyResult = { valid: boolean; missing: string[] };

export async function verifyPack(communityId: string): Promise<PackVerifyResult> {
  if (Platform.OS === 'web') {
    const all = await loadAllPacksWeb();
    const valid = !!all[communityId];
    return { valid, missing: valid ? [] : ['pack_blob'] };
  }

  const mmkv = getMMKV();
  const metaStr: string | undefined = mmkv.getString(MMKV_KEY_PREFIX + communityId);
  if (!metaStr) {
    return { valid: false, missing: ['mmkv_meta'] };
  }

  const dir = getPackDir(communityId);
  const missing: string[] = [];

  async function checkFile(filename: string): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(`${dir}${filename}`, { size: true });
    if (!info.exists) return false;
    const sizeInfo = info as FileSystem.FileInfo & { size?: number };
    return typeof sizeInfo.size !== 'number' || sizeInfo.size > 0;
  }

  for (const file of ['assetIndex.json', 'workHistory.json', 'layerIndex.json']) {
    if (!(await checkFile(file))) missing.push(file);
  }

  if (missing.length === 0) {
    try {
      const layerIndex = await readJson(`${dir}layerIndex.json`);
      if (layerIndex) {
        for (const [, safe] of Object.entries(layerIndex as Record<string, string>)) {
          if (!(await checkFile(`layer_${safe}.json`))) {
            missing.push(`layer_${safe}.json`);
          }
        }
      }
    } catch {}
  }

  return { valid: missing.length === 0, missing };
}

export async function migrateFromAsyncStorage(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const legacyJson = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyJson) return;

    const legacy: Record<string, PackMeta> = JSON.parse(legacyJson);
    const communityIds = Object.keys(legacy);
    if (communityIds.length === 0) {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }

    for (const communityId of communityIds) {
      const pack = legacy[communityId];
      if (pack) {
        await savePack({ ...pack, checksum: (pack as any).checksum ?? null });
      }
    }

    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    console.log(`[packStorage] Migrated ${communityIds.length} offline pack(s) from AsyncStorage to MMKV+FileSystem.`);
  } catch (e) {
    console.error('[packStorage] Migration from AsyncStorage failed:', e);
  }
}
