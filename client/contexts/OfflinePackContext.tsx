import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from './CommunityContext';
import { useOffline } from './OfflineContext';

const PACK_META_KEY = 'offline_pack_meta';

type PackMeta = {
  communityId: string;
  packId: string;
  packVersion: number;
  downloadedAt: string;
  manifest: PackManifest;
  assetIndex: Record<string, AssetIndexEntry>;
  geojsonBundle: Record<string, any>;
  workHistorySnapshot: Record<string, any[]>;
};

type PackManifest = {
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

type AssetIndexEntry = {
  assetId: string;
  label: string;
  assetType: string;
  properties: { key: string; value: string }[];
};

type ServerPackInfo = {
  id: string;
  communityId: string;
  packVersion: number;
  updatedAt: string;
  checksum: string | null;
} | null;

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
  const localPack = communityId ? allPacks[communityId] || null : null;
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
      const json = await AsyncStorage.getItem(PACK_META_KEY);
      if (json) {
        setAllPacks(JSON.parse(json));
      }
    } catch (e) {
      console.error('Failed to load offline pack meta:', e);
    }
  };

  const persistPacks = async (packs: Record<string, PackMeta>) => {
    await AsyncStorage.setItem(PACK_META_KEY, JSON.stringify(packs));
    setAllPacks(packs);
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
        manifest: data.manifest,
        assetIndex: data.assetIndex,
        geojsonBundle: data.geojsonBundle,
        workHistorySnapshot: data.workHistorySnapshot || {},
      };

      const updated = { ...allPacks, [communityId]: packMeta };
      await persistPacks(updated);
      setServerPackInfo(data.pack);
      setDownloadProgress('');
    } catch (e: any) {
      console.error('Failed to download offline pack:', e);
      setDownloadProgress('Download failed: ' + (e.message || 'Unknown error'));
      throw e;
    } finally {
      setIsDownloading(false);
    }
  }, [communityId, isDownloading, allPacks]);

  const deletePack = useCallback(async () => {
    if (!communityId) return;
    const updated = { ...allPacks };
    delete updated[communityId];
    await persistPacks(updated);
  }, [communityId, allPacks]);

  const getOfflineGeoJSON = useCallback((layerId: string) => {
    if (!localPack) return null;
    return localPack.geojsonBundle[layerId] || null;
  }, [localPack]);

  const getOfflineManifest = useCallback(() => {
    return localPack?.manifest || null;
  }, [localPack]);

  const resolveFeatureToAsset = useCallback((featureRef: string) => {
    if (!localPack) return null;
    return localPack.assetIndex[featureRef] || null;
  }, [localPack]);

  const getOfflineWorkHistory = useCallback((assetId: string) => {
    if (!localPack) return null;
    return localPack.workHistorySnapshot[assetId] || null;
  }, [localPack]);

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
