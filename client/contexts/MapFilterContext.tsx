import React, { createContext, useContext, useState, useCallback } from 'react';

export type MapFilter =
  | { type: 'date'; date: string; label: string }
  | { type: 'task'; taskId: string; label: string }
  | null;

type MapFilterContextValue = {
  mapFilter: MapFilter;
  setMapFilter: (filter: MapFilter) => void;
  clearMapFilter: () => void;
};

const MapFilterContext = createContext<MapFilterContextValue>({
  mapFilter: null,
  setMapFilter: () => {},
  clearMapFilter: () => {},
});

export function MapFilterProvider({ children }: { children: React.ReactNode }) {
  const [mapFilter, setMapFilterState] = useState<MapFilter>(null);

  const setMapFilter = useCallback((filter: MapFilter) => {
    setMapFilterState(filter);
  }, []);

  const clearMapFilter = useCallback(() => {
    setMapFilterState(null);
  }, []);

  return (
    <MapFilterContext.Provider value={{ mapFilter, setMapFilter, clearMapFilter }}>
      {children}
    </MapFilterContext.Provider>
  );
}

export function useMapFilter() {
  return useContext(MapFilterContext);
}
