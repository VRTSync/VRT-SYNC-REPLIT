import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from './CommunityContext';
import { useOffline } from './OfflineContext';
import {
  savePack,
  loadPack,
  deletePack as deletePackFromStorage,
  listPackCommunityIds,
  verifyPack,
  migrateFromAsyncStorage,
  type PackMeta,
  type PackManifest,
  type AssetIndexEntry,
  type SearchIndex,
  type SearchIndexAsset,
  type SearchIndexTask,
} from '@/lib/packStorage';

type ServerPackInfo = {
  id: string;
  communityId: string;
  packVersion: number;
  updatedAt: string;
  checksum: string | null;
} | null;

type OfflineSearchResult = {
  id: string;
  type: 'asset' | 'task';
  label: string;
  assetType?: string;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  communityId: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  relevance: number;
  matchField?: string;
  isOffline: boolean;
  offlineSnapshot?: SearchIndexAsset | SearchIndexTask;
};

type OfflinePackContextType = {
  localPack: PackMeta | null;
  serverPackInfo: ServerPackInfo;
  isDownloading: boolean;
  downloadProgress: string;
  hasUpdate: boolean;
  downloadPack: () => Promise<void>;
  deletePack: () => Promise<void>;
  refreshServerInfo: () => Promise<void>;
  getOfflineGeoJSON: (layerId: string) => any | null;
  getOfflineManifest: () => PackManifest | null;
  resolveFeatureToAsset: (featureRef: string) => AssetIndexEntry | null;
  getOfflineWorkHistory: (assetId: string) => any[] | null;
  searchOffline: (query: string) => OfflineSearchResult[];
  hasSearchIndex: boolean;
};

const OfflinePackContext = createContext<OfflinePackContextType | null>(null);

export function OfflinePackProvider({ children }: { children: ReactNode }) {
  const { activeCommunity } = useCommunity();
  const { isOnline } = useOffline();
  const [allPacks, setAllPacks] = useState<Record<string, PackMeta>>({});
  const [serverPackInfo, setServerPackInfo] = useState<ServerPackInfo>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  const communityId = activeCommunity?.id;
  const localPack = communityId ? allPacks[communityId] ?? null : null;
  const hasUpdate = !!(serverPackInfo && localPack && serverPackInfo.packVersion > localPack.packVersion);

  useEffect(() => {
    loadPacksFromStorage();
  }, []);

  useEffect(() => {
    if (communityId && isOnline) {
      fetchServerPackInfo(communityId);
    }
  }, [communityId, isOnline]);

  const loadPacksFromStorage = async () => {
    try {
      await migrateFromAsyncStorage();

      const communityIds = await listPackCommunityIds();
      if (communityIds.length === 0) return;

      const entries = await Promise.all(
        communityIds.map(async (cId) => {
          const { valid } = await verifyPack(cId);
          if (!valid) {
            await deletePackFromStorage(cId);
            return null;
          }
          const pack = await loadPack(cId);
          return pack ? ([cId, pack] as [string, PackMeta]) : null;
        }),
      );

      const loaded: Record<string, PackMeta> = {};
      for (const entry of entries) {
        if (entry) loaded[entry[0]] = entry[1];
      }
      setAllPacks(loaded);
    } catch (e) {
      console.error('Failed to load offline packs:', e);
    }
  };

  const fetchServerPackInfo = async (cId: string) => {
    try {
      const res = await apiRequest('GET', `/api/communities/${cId}/offline-pack`);
      const data = await res.json();
      setServerPackInfo(data);
    } catch {
      setServerPackInfo(null);
    }
  };

  const refreshServerInfo = useCallback(async () => {
    if (communityId) {
      await fetchServerPackInfo(communityId);
    }
  }, [communityId]);

  const downloadPack = useCallback(async () => {
    if (!communityId || isDownloading) return;
    setIsDownloading(true);
    setDownloadProgress('Fetching pack data...');
    try {
      const res = await apiRequest('GET', `/api/communities/${communityId}/offline-pack-data`);
      const data = await res.json();

      setDownloadProgress('Saving to device...');

      const packMeta: PackMeta = {
        communityId,
        packId: data.pack.id,
        packVersion: data.pack.packVersion,
        downloadedAt: new Date().toISOString(),
        checksum: data.pack.checksum ?? null,
        manifest: data.manifest,
        assetIndex: data.assetIndex,
        geojsonBundle: data.geojsonBundle,
        workHistorySnapshot: data.workHistorySnapshot || {},
        searchIndex: data.searchIndex || undefined,
      };

      await savePack(packMeta);
      setAllPacks((prev) => ({ ...prev, [communityId]: packMeta }));
      setServerPackInfo(data.pack);
      setDownloadProgress('');
    } catch (e: any) {
      console.error('Failed to download offline pack:', e);
      setDownloadProgress('Download failed: ' + (e.message || 'Unknown error'));
      throw e;
    } finally {
      setIsDownloading(false);
    }
  }, [communityId, isDownloading]);

  const deletePack = useCallback(async () => {
    if (!communityId) return;
    await deletePackFromStorage(communityId);
    setAllPacks((prev) => {
      const updated = { ...prev };
      delete updated[communityId];
      return updated;
    });
  }, [communityId]);

  const getOfflineGeoJSON = useCallback(
    (layerId: string) => {
      if (!localPack) return null;
      return localPack.geojsonBundle[layerId] ?? null;
    },
    [localPack],
  );

  const getOfflineManifest = useCallback(() => {
    return localPack?.manifest ?? null;
  }, [localPack]);

  const resolveFeatureToAsset = useCallback(
    (featureRef: string) => {
      if (!localPack) return null;
      return localPack.assetIndex[featureRef] ?? null;
    },
    [localPack],
  );

  const getOfflineWorkHistory = useCallback(
    (assetId: string) => {
      if (!localPack) return null;
      return localPack.workHistorySnapshot[assetId] ?? null;
    },
    [localPack],
  );

  const hasSearchIndex = !!(localPack?.searchIndex);

  const searchOffline = useCallback(
    (query: string): OfflineSearchResult[] => {
      if (!localPack?.searchIndex || !communityId) return [];
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];

      const results: OfflineSearchResult[] = [];
      const { assets: indexAssets, tasks: indexTasks } = localPack.searchIndex;

      for (const a of indexAssets) {
        if (a.isArchived) continue;
        let relevance = 0;
        let matchField: string | undefined;
        const labelLower = a.label.toLowerCase();
        const refLower = (a.featureRef || '').toLowerCase();

        if (labelLower === q) { relevance = 100; matchField = 'label'; }
        else if (labelLower.startsWith(q)) { relevance = 80; matchField = 'label'; }
        else if (labelLower.includes(q)) { relevance = 60; matchField = 'label'; }
        else if (refLower.includes(q)) { relevance = 50; matchField = 'featureRef'; }
        else {
          for (const [key, val] of Object.entries(a.props)) {
            if (val.toLowerCase().includes(q)) {
              const valLower = val.toLowerCase();
              if (valLower === q) relevance = 90;
              else if (valLower.startsWith(q)) relevance = 70;
              else relevance = 50;
              matchField = key;
              break;
            }
          }
        }

        if (relevance > 0) {
          results.push({
            id: a.id, type: 'asset', label: a.label, assetType: a.assetType,
            communityId, latitude: a.latitude, longitude: a.longitude,
            relevance, matchField, isOffline: true, offlineSnapshot: a,
            address: a.props.address || null,
          });
        }
      }

      for (const t of indexTasks) {
        let relevance = 0;
        const titleLower = t.title.toLowerCase();
        const addrLower = (t.address || '').toLowerCase();

        if (titleLower === q) relevance = 100;
        else if (titleLower.startsWith(q)) relevance = 80;
        else if (titleLower.includes(q)) relevance = 65;
        else if (addrLower.includes(q)) relevance = 55;

        if (relevance > 0) {
          results.push({
            id: t.id, type: 'task', label: t.title, status: t.status,
            priority: t.priority, dueDate: t.dueDate, communityId,
            latitude: t.latitude, longitude: t.longitude, address: t.address,
            relevance, isOffline: true, offlineSnapshot: t,
          });
        }
      }

      results.sort((a, b) => b.relevance - a.relevance);
      return results.slice(0, 30);
    },
    [localPack, communityId],
  );

  return (
    <OfflinePackContext.Provider
      value={{
        localPack,
        serverPackInfo,
        isDownloading,
        downloadProgress,
        hasUpdate,
        downloadPack,
        deletePack,
        refreshServerInfo,
        getOfflineGeoJSON,
        getOfflineManifest,
        resolveFeatureToAsset,
        getOfflineWorkHistory,
        searchOffline,
        hasSearchIndex,
      }}
    >
      {children}
    </OfflinePackContext.Provider>
  );
}

export function useOfflinePack() {
  const ctx = useContext(OfflinePackContext);
  if (!ctx) throw new Error('useOfflinePack must be used within OfflinePackProvider');
  return ctx;
}
