import { useState, useRef, useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus, Linking } from 'react-native';
import * as Location from 'expo-location';

export type LockState = 'red' | 'yellow' | 'green';
export type CaptureMode = 'strict' | 'canopy';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  sampleCount?: number;
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
  mode?: CaptureMode;
}

export interface CaptureStationaryOptions {
  mode?: CaptureMode;
  targetSamples?: number;
  timeoutMs?: number;
  onProgress?: (samplesCount: number, totalTarget: number, elapsedMs: number) => void;
}

export type CaptureResult = Fix | { aborted: 'moved' | 'timeout' | 'permission' };

export interface UseHighAccuracyLocationResult {
  fix: FixSnapshot | null;
  isWatching: boolean;
  permissionDenied: boolean;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  snapshot: () => Fix | null;
  openSettings: () => void;
  captureStationary: (options?: CaptureStationaryOptions) => Promise<CaptureResult>;
}

interface InternalState {
  fix: FixSnapshot | null;
  isWatching: boolean;
  permissionDenied: boolean;
}

const DEFAULT_BUFFER_SIZE = 10;
const DEFAULT_MIN_SAMPLES = 5;

const STRICT_OUTLIER_MAX = 10;
const STRICT_GREEN = 2.5;
const STRICT_YELLOW = 5;
const STRICT_DRIFT = 1.0;

const CANOPY_OUTLIER_MAX = 15;
const CANOPY_GREEN = 5;
const CANOPY_YELLOW = 8;
const CANOPY_DRIFT = 1.5;

const CAPTURE_TARGET_SAMPLES = 15;
const CAPTURE_TIMEOUT_MS = 30_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getModeThresholds(mode: CaptureMode) {
  if (mode === 'canopy') {
    return {
      greenThreshold: CANOPY_GREEN,
      yellowThreshold: CANOPY_YELLOW,
      outlierAccuracyMax: CANOPY_OUTLIER_MAX,
      driftMetres: CANOPY_DRIFT,
    };
  }
  return {
    greenThreshold: STRICT_GREEN,
    yellowThreshold: STRICT_YELLOW,
    outlierAccuracyMax: STRICT_OUTLIER_MAX,
    driftMetres: STRICT_DRIFT,
  };
}

export function useHighAccuracyLocation(
  options: UseHighAccuracyLocationOptions = {}
): UseHighAccuracyLocationResult {
  const captureMode = options.mode ?? 'strict';
  const modeThresholds = getModeThresholds(captureMode);

  const {
    bufferSize = DEFAULT_BUFFER_SIZE,
    minSamplesForLock = DEFAULT_MIN_SAMPLES,
    outlierAccuracyMax = modeThresholds.outlierAccuracyMax,
    greenThreshold = modeThresholds.greenThreshold,
    yellowThreshold = modeThresholds.yellowThreshold,
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
  const permissionDeniedRef = useRef(false);

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

  // Refs so the live watcher callback always reads the latest computeFix / outlierMax
  // without needing to restart the subscription when captureMode changes.
  const computeFixRef = useRef(computeFix);
  useEffect(() => { computeFixRef.current = computeFix; }, [computeFix]);

  // Stable ref to start() so the AppState handler can re-check permissions
  // without adding start to the effect dependency array.
  const startRef = useRef<() => Promise<void>>(async () => {});

  const outlierAccuracyMaxRef = useRef(outlierAccuracyMax);
  useEffect(() => { outlierAccuracyMaxRef.current = outlierAccuracyMax; }, [outlierAccuracyMax]);

  // Clear the rolling buffer when mode changes so stale samples don't contaminate
  // the new threshold's lock computation.
  const prevCaptureModeRef = useRef<CaptureMode>(captureMode);
  useEffect(() => {
    if (prevCaptureModeRef.current !== captureMode) {
      prevCaptureModeRef.current = captureMode;
      bufferRef.current = [];
      setState((prev) => ({ ...prev, fix: null }));
    }
  }, [captureMode]);

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

        if (fix.accuracy > outlierAccuracyMaxRef.current) {
          return;
        }

        lastFixTimeRef.current = fix.timestamp;

        bufferRef.current = [
          ...bufferRef.current.slice(-(bufferSize - 1)),
          fix,
        ];

        const computed = computeFixRef.current(bufferRef.current);
        const adjustedFix: FixSnapshot | null = computed
          ? { ...computed, lastFixAge: Date.now() - fix.timestamp }
          : null;

        setState((prev) => ({ ...prev, fix: adjustedFix }));
      }
    );

    watcherRef.current = sub;
  }, [bufferSize]);

  const start = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      permissionDeniedRef.current = true;
      setState((prev) => ({ ...prev, permissionDenied: true, isWatching: false }));
      return;
    }

    permissionDeniedRef.current = false;
    setState((prev) => ({ ...prev, permissionDenied: false, isWatching: true }));
    isWatchingRef.current = true;
    await startWatcher();
  }, [startWatcher]);

  // Keep startRef in sync so the AppState handler can call start() without
  // listing it as a dependency (start is stable but this is safer than closure capture).
  startRef.current = start;

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
    const currentFix = computeFixRef.current(bufferRef.current);
    if (!currentFix) return null;
    return {
      latitude: currentFix.latitude,
      longitude: currentFix.longitude,
      accuracy: currentFix.accuracy,
      timestamp: lastFixTimeRef.current ?? Date.now(),
    };
  }, []);

  const openSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  const captureStationary = useCallback(
    async (opts: CaptureStationaryOptions = {}): Promise<CaptureResult> => {
      const mode = opts.mode ?? captureMode;
      const thresholds = getModeThresholds(mode);
      const targetSamples = opts.targetSamples ?? CAPTURE_TARGET_SAMPLES;
      const timeoutMs = opts.timeoutMs ?? CAPTURE_TIMEOUT_MS;
      const onProgress = opts.onProgress;

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return { aborted: 'permission' };
      }

      return new Promise<CaptureResult>((resolve) => {
        const samples: Fix[] = [];
        let anchorLat: number | null = null;
        let anchorLon: number | null = null;
        let sub: Location.LocationSubscription | null = null;
        let timedOut = false;
        // pendingRemove: set when cleanup() is called before the .then() subscription
        // promise has resolved. The .then() handler checks this flag and immediately
        // removes the subscription, preventing it from leaking.
        let pendingRemove = false;
        const startTs = Date.now();

        const cleanup = () => {
          if (sub) {
            sub.remove();
            sub = null;
          } else {
            pendingRemove = true;
          }
        };

        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          cleanup();
          resolve({ aborted: 'timeout' });
        }, timeoutMs);

        Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 300,
            distanceInterval: 0,
          },
          (location) => {
            if (timedOut) return;

            const acc = location.coords.accuracy ?? 999;
            if (acc > thresholds.outlierAccuracyMax) return;

            const lat = location.coords.latitude;
            const lon = location.coords.longitude;

            if (anchorLat === null) {
              anchorLat = lat;
              anchorLon = lon;
            } else {
              const drift = haversineMetres(anchorLat, anchorLon!, lat, lon);
              if (drift > thresholds.driftMetres) {
                clearTimeout(timeoutHandle);
                cleanup();
                resolve({ aborted: 'moved' });
                return;
              }
            }

            samples.push({ latitude: lat, longitude: lon, accuracy: acc, timestamp: location.timestamp });
            onProgress?.(samples.length, targetSamples, Date.now() - startTs);

            if (samples.length >= targetSamples) {
              const avgLat = samples.reduce((s, f) => s + f.latitude, 0) / samples.length;
              const avgLon = samples.reduce((s, f) => s + f.longitude, 0) / samples.length;
              const medAcc = median(samples.map((f) => f.accuracy));

              // Only resolve when the rolling median satisfies the green threshold.
              // If quality never reaches green before timeoutMs, the timeout fires instead
              // and resolves { aborted: 'timeout' }. Keeping the rolling buffer means
              // newer (better) samples continue to improve the median as the device settles.
              if (medAcc <= thresholds.greenThreshold) {
                clearTimeout(timeoutHandle);
                cleanup();
                resolve({
                  latitude: avgLat,
                  longitude: avgLon,
                  accuracy: medAcc,
                  timestamp: samples[samples.length - 1].timestamp,
                  sampleCount: samples.length,
                });
              }
            }
          }
        ).then((s) => {
          // Guard: if cleanup() was called before this .then() ran (timedOut, moved,
          // or samples collected), remove the subscription immediately.
          if (timedOut || pendingRemove) {
            s.remove();
          } else {
            sub = s;
          }
        }).catch(() => {
          clearTimeout(timeoutHandle);
          resolve({ aborted: 'permission' });
        });
      });
    },
    [captureMode]
  );

  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        if (permissionDeniedRef.current) {
          // User may have just granted location in Settings — re-run the full
          // start() path so the permission check fires again and the watcher
          // starts cleanly if access was granted.
          await startRef.current();
        } else if (isWatchingRef.current && !watcherRef.current) {
          await startWatcher();
        }
      } else if (watcherRef.current) {
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
    captureStationary,
  };
}
