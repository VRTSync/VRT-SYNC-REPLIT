import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export function useTimeTick(intervalMs = 60_000): number {
  const [tick, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setTick(t => t + 1);
      const id = setInterval(() => setTick(t => t + 1), intervalMs);
      return () => clearInterval(id);
    }, [intervalMs]),
  );

  return tick;
}
