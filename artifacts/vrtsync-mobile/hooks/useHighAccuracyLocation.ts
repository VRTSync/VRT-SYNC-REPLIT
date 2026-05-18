import { useState, useRef, useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus, Linking } from 'react-native';
import * as Location from 'expo-location';

export type LockState = 'red' | 'yellow' | 'green';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface FixSnapshot {
  lockState: LockState;
  latitude: number;
  longitude: number;
  accuracy: number;
  sampleCount: number;
  lastFixAge: number;
}

export interface UseHighAccuracyLocationOptions {
  bufferSize?: number;
  minSamplesForLock?: number;
  outlierAccuracyMax?: number;
  greenThreshold?: number;
  yellowThreshold?: number;
}

export interface UseHighAccuracyLocationResult {
  fix: FixSnapshot | null;
  isWatching: boolean;
  permissionDenied: boolean;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  snapshot: () => Fix | null;
  openSettings: () => void;
}

interface InternalState {
  fix: FixSnapshot | null;
  isWatching: boolean;
  permissionDenied: boolean;
}

const DEFAULT_BUFFER_SIZE = 10;
const DEFAULT_MIN_SAMPLES = 5;
const DEFAULT_OUTLIER_MAX = 50;
const DEFAULT_GREEN_THRESHOLD = 5;
const DEFAULT_YELLOW_THRESHOLD = 15;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function useHighAccuracyLocation(
  options: UseHighAccuracyLocationOptions = {}
): UseHighAccuracyLocationResult {
  const {
    bufferSize = DEFAULT_BUFFER_SIZE,
    minSamplesForLock = DEFAULT_MIN_SAMPLES,
    outlierAccuracyMax = DEFAULT_OUTLIER_MAX,
    greenThreshold = DEFAULT_GREEN_THRESHOLD,
    yellowThreshold = DEFAULT_YELLOW_THRESHOLD,
  } = options;

  const [state, setState] = useState<InternalState>({
    fix: null,
    isWatching: false,
    permissionDenied: false,
  });

  const bufferRef = useRef<Fix[]>([]);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const isWatchingRef = useRef(false);
  const lastFixTimeRef = useRef<number | null>(null);

  const computeFix = useCallback(
    (buffer: Fix[]): FixSnapshot | null => {
      if (buffer.length === 0) return null;

      const avgLat = buffer.reduce((s, f) => s + f.latitude, 0) / buffer.length;
      const avgLng = buffer.reduce((s, f) => s + f.longitude, 0) / buffer.length;
      const medAccuracy = median(buffer.map((f) => f.accuracy));
      const lastTs = Math.max(...buffer.map((f) => f.timestamp));
      const age = Date.now() - lastTs;

      let lockState: LockState = 'red';
      if (buffer.length >= minSamplesForLock) {
        if (medAccuracy <= greenThreshold) {
          lockState = 'green';
        } else if (medAccuracy <= yellowThreshold) {
          lockState = 'yellow';
        }
      }

      if (lockState === 'red') return null;

      return {
        lockState,
        latitude: avgLat,
        longitude: avgLng,
        accuracy: medAccuracy,
        sampleCount: buffer.length,
        lastFixAge: age,
      };
    },
    [minSamplesForLock, greenThreshold, yellowThreshold]
  );

  const startWatcher = useCallback(async () => {
    if (watcherRef.current) return;

    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 500,
        distanceInterval: 0,
      },
      (location) => {
        const fix: Fix = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? 999,
          timestamp: location.timestamp,
        };

        if (fix.accuracy > outlierAccuracyMax) {
          return;
        }

        lastFixTimeRef.current = fix.timestamp;

        bufferRef.current = [
          ...bufferRef.current.slice(-(bufferSize - 1)),
          fix,
        ];

        const computed = computeFix(bufferRef.current);
        const adjustedFix: FixSnapshot | null = computed
          ? { ...computed, lastFixAge: Date.now() - fix.timestamp }
          : null;

        setState((prev) => ({ ...prev, fix: adjustedFix }));
      }
    );

    watcherRef.current = sub;
  }, [bufferSize, outlierAccuracyMax, computeFix]);

  const start = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setState((prev) => ({ ...prev, permissionDenied: true, isWatching: false }));
      return;
    }

    setState((prev) => ({ ...prev, permissionDenied: false, isWatching: true }));
    isWatchingRef.current = true;
    await startWatcher();
  }, [startWatcher]);

  const stop = useCallback(() => {
    if (watcherRef.current) {
      watcherRef.current.remove();
      watcherRef.current = null;
    }
    isWatchingRef.current = false;
    setState((prev) => ({ ...prev, isWatching: false }));
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = [];
    setState((prev) => ({ ...prev, fix: null }));
  }, []);

  const snapshot = useCallback((): Fix | null => {
    const currentFix = computeFix(bufferRef.current);
    if (!currentFix) return null;
    return {
      latitude: currentFix.latitude,
      longitude: currentFix.longitude,
      accuracy: currentFix.accuracy,
      timestamp: lastFixTimeRef.current ?? Date.now(),
    };
  }, [computeFix]);

  const openSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'active' && isWatchingRef.current && !watcherRef.current) {
        await startWatcher();
      } else if (nextState !== 'active' && watcherRef.current) {
        watcherRef.current.remove();
        watcherRef.current = null;
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [startWatcher]);

  useEffect(() => {
    return () => {
      if (watcherRef.current) {
        watcherRef.current.remove();
        watcherRef.current = null;
      }
    };
  }, []);

  return {
    fix: state.fix,
    isWatching: state.isWatching,
    permissionDenied: state.permissionDenied,
    start,
    stop,
    reset,
    snapshot,
    openSettings,
  };
}
