/**
 * AssetTypeContext.tsx
 *
 * Fetches the asset_types catalogue from /api/asset-types on app start and
 * caches it via React Query (persisted to AsyncStorage via
 * PersistQueryClientProvider).  For offline scenarios the persisted cache
 * provides the last known type list automatically.
 *
 * Graceful degradation: if an asset type key is not in the catalogue, helpers
 * return a title-cased label derived from the key and a null color — the asset
 * is always rendered, never dropped.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';

export type AssetTypeInfo = {
  key: string;
  label: string;
  layerKey: string;
  subLayerKey: string;
  allowedGeometry: string[] | null;
  requiredKeys: string[];
  optionalKeys: string[];
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
};

type AssetTypeContextType = {
  /** All active asset types from the server catalogue. */
  assetTypes: AssetTypeInfo[];
  /** Human-readable label for a type key. Falls back to title-cased key. */
  getLabel: (key: string) => string;
  /** Required property keys for a type. Returns [] for unknown types. */
  getRequiredKeys: (key: string) => string[];
  /** Optional property keys for a type. Returns [] for unknown types. */
  getOptionalKeys: (key: string) => string[];
  /** True once the first fetch has completed (cache may still be stale). */
  isLoaded: boolean;
};

const AssetTypeContext = createContext<AssetTypeContextType | null>(null);

/**
 * Converts an asset type key to a human-readable label using camelCase/
 * snake_case splitting: "parking_sweep" → "Parking Sweep",
 * "backflowType" → "Backflow Type".
 */
export function deriveLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AssetTypeProvider({ children }: { children: React.ReactNode }) {
  const { data = [], isSuccess } = useQuery<AssetTypeInfo[]>({
    queryKey: ['/api/asset-types'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/asset-types');
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
  });

  const typeMap = useMemo(() => {
    const map = new Map<string, AssetTypeInfo>();
    for (const t of data) map.set(t.key, t);
    return map;
  }, [data]);

  const getLabel = (key: string) => typeMap.get(key)?.label ?? deriveLabel(key);
  const getRequiredKeys = (key: string) => typeMap.get(key)?.requiredKeys ?? [];
  const getOptionalKeys = (key: string) => typeMap.get(key)?.optionalKeys ?? [];

  return (
    <AssetTypeContext.Provider
      value={{
        assetTypes: data,
        getLabel,
        getRequiredKeys,
        getOptionalKeys,
        isLoaded: isSuccess,
      }}
    >
      {children}
    </AssetTypeContext.Provider>
  );
}

export function useAssetTypes(): AssetTypeContextType {
  const ctx = useContext(AssetTypeContext);
  if (!ctx) throw new Error('useAssetTypes must be used within <AssetTypeProvider>');
  return ctx;
}
