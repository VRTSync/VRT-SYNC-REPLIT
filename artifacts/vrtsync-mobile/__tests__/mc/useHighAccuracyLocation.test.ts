import { renderHook, act } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import { useHighAccuracyLocation } from '@/hooks/useHighAccuracyLocation';

let capturedCallback: ((loc: any) => void) | null = null;
const mockSubscriptionRemove = jest.fn();

jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  watchPositionAsync: jest.fn().mockImplementation(
    (_opts: unknown, cb: (loc: any) => void) => {
      capturedCallback = cb;
      return Promise.resolve({ remove: mockSubscriptionRemove });
    },
  ),
}));

function makeLoc(lat: number, lng: number, accuracy: number, ts = Date.now()) {
  return { coords: { latitude: lat, longitude: lng, accuracy }, timestamp: ts };
}

const OPTS = {
  bufferSize: 10,
  minSamplesForLock: 3,
  outlierAccuracyMax: 50,
  greenThreshold: 5,
  yellowThreshold: 15,
};

describe('useHighAccuracyLocation', () => {
  beforeEach(() => {
    capturedCallback = null;
    jest.clearAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  });

  async function startHook(result: { current: ReturnType<typeof useHighAccuracyLocation> }) {
    await act(async () => {
      await result.current.start();
    });
  }

  function pushFix(lat: number, lng: number, accuracy: number, ts = Date.now()) {
    act(() => {
      capturedCallback!(makeLoc(lat, lng, accuracy, ts));
    });
  }

  it('fix is null before any positions are received', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    expect(result.current.fix).toBeNull();
  });

  it('outlier fixes (accuracy > outlierAccuracyMax) are silently discarded', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    for (let i = 0; i < 5; i++) {
      pushFix(37.0, -122.0, 100);
    }
    expect(result.current.fix).toBeNull();
  });

  it('fix is null when sampleCount is below minSamplesForLock', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    pushFix(37.0, -122.0, 3);
    pushFix(37.0, -122.0, 3);
    expect(result.current.fix).toBeNull();
  });

  it('fix.lockState is "yellow" when medAccuracy is between greenThreshold and yellowThreshold', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    for (let i = 0; i < 3; i++) {
      pushFix(37.0, -122.0, 10);
    }
    expect(result.current.fix).not.toBeNull();
    expect(result.current.fix!.lockState).toBe('yellow');
  });

  it('fix.lockState is "green" when medAccuracy is at or below greenThreshold', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    for (let i = 0; i < 3; i++) {
      pushFix(37.0, -122.0, 3);
    }
    expect(result.current.fix).not.toBeNull();
    expect(result.current.fix!.lockState).toBe('green');
  });

  it('fix.latitude and fix.longitude are the arithmetic mean of buffered fixes', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    pushFix(37.0, -122.0, 3);
    pushFix(37.2, -122.2, 3);
    pushFix(37.4, -122.4, 3);
    expect(result.current.fix).not.toBeNull();
    expect(result.current.fix!.latitude).toBeCloseTo((37.0 + 37.2 + 37.4) / 3, 5);
    expect(result.current.fix!.longitude).toBeCloseTo((-122.0 + -122.2 + -122.4) / 3, 5);
  });

  it('snapshot() returns null when fix is null (red lock / no valid samples)', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    expect(result.current.fix).toBeNull();
    expect(result.current.snapshot()).toBeNull();
  });

  it('reset() clears buffer so fix returns to null; stop() sets isWatching to false', async () => {
    const { result } = renderHook(() => useHighAccuracyLocation(OPTS));
    await startHook(result);
    for (let i = 0; i < 3; i++) {
      pushFix(37.0, -122.0, 3);
    }
    expect(result.current.fix).not.toBeNull();
    act(() => {
      result.current.reset();
    });
    expect(result.current.fix).toBeNull();
    act(() => {
      result.current.stop();
    });
    expect(result.current.isWatching).toBe(false);
  });
});
