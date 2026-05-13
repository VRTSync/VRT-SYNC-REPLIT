import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { pinCreationQueue, type PendingPinEntry } from '@/lib/pinCreationQueue';
import { pinSyncOrchestrator } from '@/lib/pinSyncOrchestrator';
import { useOffline } from '@/client/contexts/OfflineContext';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const IDLE_SYNC_INTERVAL_MS = 30 * 60 * 1000;

type PinQueueContextType = {
  pendingEntries: PendingPinEntry[];
  syncNow: () => Promise<void>;
  retryEntry: (entryId: string) => Promise<void>;
  refreshList: () => void;
};

const PinQueueContext = createContext<PinQueueContextType | null>(null);

export function PinQueueProvider({ children }: { children: ReactNode }) {
  const [pendingEntries, setPendingEntries] = useState<PendingPinEntry[]>([]);
  const { isOnline } = useOffline();
  const queryClient = useQueryClient();

  const isOnlineRef = useRef(isOnline);
  const prevIsOnlineRef = useRef(isOnline);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  const refreshList = useCallback(() => {
    setPendingEntries(pinCreationQueue.list());
  }, []);

  const syncNow = useCallback(async () => {
    pinSyncOrchestrator.setQueryClient(queryClient);
    await pinSyncOrchestrator.run();
    refreshList();
  }, [queryClient, refreshList]);

  const retryEntry = useCallback(
    async (entryId: string) => {
      pinSyncOrchestrator.setQueryClient(queryClient);
      await pinSyncOrchestrator.run({ entryId, ignoreBackoff: true });
      refreshList();
    },
    [queryClient, refreshList],
  );

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        pinCreationQueue.clearSyncedOlderThan(SEVEN_DAYS_MS).then(() => refreshList());
        if (isOnlineRef.current) {
          syncNow();
        }
      }
    });
    return () => sub.remove();
  }, [syncNow, refreshList]);

  useEffect(() => {
    if (isOnline && !prevIsOnlineRef.current) {
      syncNow();
    }
    prevIsOnlineRef.current = isOnline;
  }, [isOnline, syncNow]);

  useEffect(() => {
    if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    idleTimerRef.current = setInterval(() => {
      if (isOnlineRef.current) {
        syncNow();
      }
    }, IDLE_SYNC_INTERVAL_MS);
    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [syncNow]);

  return (
    <PinQueueContext.Provider value={{ pendingEntries, syncNow, retryEntry, refreshList }}>
      {children}
    </PinQueueContext.Provider>
  );
}

export function usePinQueue(): PinQueueContextType {
  const ctx = useContext(PinQueueContext);
  if (!ctx) throw new Error('usePinQueue must be used inside PinQueueProvider');
  return ctx;
}
