import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type SyncBarProps = {
  onSync: () => Promise<void>;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
};

function getRelativeTime(date: Date | null): string {
  if (!date) return 'Never synced';
  const diffMs = Date.now() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 10) return 'Synced just now';
  if (diffSecs < 60) return `Synced ${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `Synced ${diffMins} min ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `Synced ${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `Synced ${diffDays}d ago`;
}

export default function SyncBar({ onSync, isSyncing, lastSyncedAt }: SyncBarProps) {
  const [label, setLabel] = useState(() => getRelativeTime(lastSyncedAt));
  const [error, setError] = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    setLabel(getRelativeTime(lastSyncedAt));
  }, [lastSyncedAt]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!error) {
        setLabel(getRelativeTime(lastSyncedAt));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [lastSyncedAt, error]);

  useEffect(() => {
    if (isSyncing) {
      spinAnimRef.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      spinAnimRef.current.start();
    } else {
      spinAnimRef.current?.stop();
      spinAnim.setValue(0);
    }
  }, [isSyncing]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const failureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (failureTimerRef.current) clearTimeout(failureTimerRef.current);
    };
  }, []);

  const handleSync = async () => {
    if (isSyncing) return;
    setError(false);
    try {
      await onSync();
      setLabel(getRelativeTime(new Date()));
    } catch {
      setError(true);
      setLabel('Sync failed');
      if (failureTimerRef.current) clearTimeout(failureTimerRef.current);
      failureTimerRef.current = setTimeout(() => {
        setError(false);
        setLabel(getRelativeTime(lastSyncedAt));
      }, 3000);
    }
  };

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        style={[styles.syncBtn, isSyncing && styles.syncBtnDisabled]}
        onPress={handleSync}
        disabled={isSyncing}
        activeOpacity={0.7}
        testID="sync-bar-button"
      >
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Ionicons
            name="refresh"
            size={14}
            color={isSyncing ? '#aaa' : '#25C1AC'}
          />
        </Animated.View>
        <Text style={[styles.syncBtnText, isSyncing && styles.syncBtnTextDisabled]}>
          {isSyncing ? 'Syncing…' : 'Sync'}
        </Text>
      </TouchableOpacity>

      <Text
        style={[styles.timestamp, error && styles.timestampError]}
        testID="sync-bar-timestamp"
      >
        {error ? 'Sync failed' : label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f0f4f8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dde2ea',
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#25C1AC',
  },
  syncBtnDisabled: {
    borderColor: '#ccc',
    backgroundColor: '#f8f8f8',
  },
  syncBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#25C1AC',
  },
  syncBtnTextDisabled: {
    color: '#aaa',
  },
  timestamp: {
    fontSize: 11,
    color: '#999',
    fontWeight: '500',
  },
  timestampError: {
    color: '#e53935',
    fontWeight: '600',
  },
});
