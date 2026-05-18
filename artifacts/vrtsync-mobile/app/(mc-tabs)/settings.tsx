import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import { useHighAccuracyLocation, type Fix } from '@/hooks/useHighAccuracyLocation';

const LOCK_COLORS: Record<string, string> = {
  red: '#f44336',
  yellow: '#f39c12',
  green: '#25C1AC',
};

const LOCK_LABELS: Record<string, string> = {
  red: 'No Lock',
  yellow: 'Acquiring',
  green: 'Locked',
};

function formatAge(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCoord(val: number | null): string {
  if (val == null) return '—';
  return val.toFixed(7);
}

function formatAccuracy(val: number | null): string {
  if (val == null) return '—';
  return `${val.toFixed(1)} m`;
}

export default function McSettingsScreen() {
  const {
    fix,
    isWatching,
    permissionDenied,
    start,
    stop,
    reset,
    snapshot,
    openSettings,
  } = useHighAccuracyLocation();

  const lockState = fix?.lockState ?? 'red';
  const latitude = fix?.latitude ?? null;
  const longitude = fix?.longitude ?? null;
  const accuracy = fix?.accuracy ?? null;
  const sampleCount = fix?.sampleCount ?? 0;
  const lastFixAge = fix?.lastFixAge ?? null;

  const [lastSnapshot, setLastSnapshot] = useState<Fix | null>(null);
  const [snapshotTime, setSnapshotTime] = useState<string | null>(null);
  const ageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [displayAge, setDisplayAge] = useState<number | null>(null);

  useEffect(() => {
    setDisplayAge(lastFixAge);
  }, [lastFixAge]);

  useEffect(() => {
    if (isWatching) {
      ageTimerRef.current = setInterval(() => {
        setDisplayAge((prev) => (prev != null ? prev + 250 : null));
      }, 250);
    } else {
      if (ageTimerRef.current) {
        clearInterval(ageTimerRef.current);
        ageTimerRef.current = null;
      }
    }
    return () => {
      if (ageTimerRef.current) {
        clearInterval(ageTimerRef.current);
      }
    };
  }, [isWatching]);

  const handleSnapshot = () => {
    const fix = snapshot();
    if (fix) {
      setLastSnapshot(fix);
      setSnapshotTime(new Date().toLocaleTimeString());
    }
  };

  const handleReset = () => {
    reset();
    setLastSnapshot(null);
    setSnapshotTime(null);
    setDisplayAge(null);
  };

  return (
    <View style={styles.outerContainer}>
      <StatusBarFill />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.pageTitle}>Settings</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Ionicons name="location-outline" size={20} color="#25C1AC" />
              <Text style={styles.cardTitle}>GPS Debug</Text>
            </View>
          </View>

          {permissionDenied ? (
            <View style={styles.permissionError}>
              <Ionicons name="warning-outline" size={20} color="#f39c12" />
              <Text style={styles.permissionErrorText}>
                Location permission was denied. Enable it in device settings to use this feature.
              </Text>
              <TouchableOpacity
                style={styles.openSettingsBtn}
                onPress={openSettings}
              >
                <Text style={styles.openSettingsBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          ) : !isWatching ? (
            <View style={styles.idleState}>
              <Ionicons name="navigate-circle-outline" size={48} color="#d1d5db" />
              <Text style={styles.idleTitle}>GPS test not running</Text>
              <Text style={styles.idleSubtitle}>
                Start to stream high-accuracy fixes and verify signal quality before placing map pins.
              </Text>
              <TouchableOpacity
                style={styles.startBtn}
                onPress={start}
                activeOpacity={0.8}
                testID="gps-start-btn"
              >
                <Ionicons name="play-circle-outline" size={18} color="#fff" />
                <Text style={styles.startBtnText}>Start GPS test</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.liveState}>
              <View style={styles.lockRow}>
                <View
                  style={[
                    styles.lockPill,
                    { backgroundColor: LOCK_COLORS[lockState] + '22' },
                  ]}
                >
                  <View
                    style={[
                      styles.lockDot,
                      { backgroundColor: LOCK_COLORS[lockState] },
                    ]}
                  />
                  <Text
                    style={[
                      styles.lockLabel,
                      { color: LOCK_COLORS[lockState] },
                    ]}
                  >
                    {LOCK_LABELS[lockState]}
                  </Text>
                </View>
              </View>

              <View style={styles.readoutGrid}>
                <View style={styles.readoutItem}>
                  <Text style={styles.readoutLabel}>Latitude</Text>
                  <Text style={styles.readoutValue}>{formatCoord(latitude)}</Text>
                </View>
                <View style={styles.readoutItem}>
                  <Text style={styles.readoutLabel}>Longitude</Text>
                  <Text style={styles.readoutValue}>{formatCoord(longitude)}</Text>
                </View>
                <View style={styles.readoutItem}>
                  <Text style={styles.readoutLabel}>Accuracy</Text>
                  <Text style={styles.readoutValue}>{formatAccuracy(accuracy)}</Text>
                </View>
                <View style={styles.readoutItem}>
                  <Text style={styles.readoutLabel}>Samples</Text>
                  <Text style={styles.readoutValue}>{sampleCount}</Text>
                </View>
                <View style={styles.readoutItem}>
                  <Text style={styles.readoutLabel}>Fix age</Text>
                  <Text style={styles.readoutValue}>{formatAge(displayAge)}</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    styles.snapshotBtn,
                    lockState === 'red' && styles.actionBtnDisabled,
                  ]}
                  onPress={handleSnapshot}
                  disabled={lockState === 'red'}
                  testID="gps-snapshot-btn"
                >
                  <Ionicons
                    name="camera-outline"
                    size={16}
                    color={lockState === 'red' ? '#bbb' : '#25C1AC'}
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      lockState === 'red' && styles.actionBtnTextDisabled,
                      { color: lockState === 'red' ? '#bbb' : '#25C1AC' },
                    ]}
                  >
                    Snapshot
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.resetBtn]}
                  onPress={handleReset}
                  testID="gps-reset-btn"
                >
                  <Ionicons name="refresh-outline" size={16} color="#666" />
                  <Text style={[styles.actionBtnText, { color: '#666' }]}>Reset</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.stopBtn]}
                  onPress={stop}
                  testID="gps-stop-btn"
                >
                  <Ionicons name="stop-circle-outline" size={16} color="#f44336" />
                  <Text style={[styles.actionBtnText, { color: '#f44336' }]}>Stop</Text>
                </TouchableOpacity>
              </View>

              {lastSnapshot && (
                <View style={styles.snapshotResult}>
                  <View style={styles.snapshotResultHeader}>
                    <Ionicons name="checkmark-circle" size={14} color="#25C1AC" />
                    <Text style={styles.snapshotResultTitle}>
                      Snapshot captured at {snapshotTime}
                    </Text>
                  </View>
                  <Text style={styles.snapshotResultText}>
                    {lastSnapshot.latitude.toFixed(7)}, {lastSnapshot.longitude.toFixed(7)}
                  </Text>
                  <Text style={styles.snapshotResultAccuracy}>
                    ±{lastSnapshot.accuracy.toFixed(1)} m
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0C1D31',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0C1D31',
  },
  permissionError: {
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  permissionErrorText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  openSettingsBtn: {
    backgroundColor: '#f39c12',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  openSettingsBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  idleState: {
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  idleTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0C1D31',
    marginTop: 4,
  },
  idleSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 19,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    marginTop: 10,
  },
  startBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  liveState: {
    padding: 16,
    gap: 16,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  lockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  lockLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  readoutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  readoutItem: {
    minWidth: '45%',
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 12,
    flex: 1,
  },
  readoutLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  readoutValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0C1D31',
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1,
  },
  snapshotBtn: {
    borderColor: '#25C1AC',
    backgroundColor: '#E6F9F6',
  },
  resetBtn: {
    borderColor: '#e0e0e0',
    backgroundColor: '#f5f7fa',
  },
  stopBtn: {
    borderColor: '#fde8e8',
    backgroundColor: '#fff5f5',
  },
  actionBtnDisabled: {
    borderColor: '#e0e0e0',
    backgroundColor: '#f5f7fa',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionBtnTextDisabled: {
    color: '#bbb',
  },
  snapshotResult: {
    backgroundColor: '#E6F9F6',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  snapshotResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  snapshotResultTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#25C1AC',
  },
  snapshotResultText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0C1D31',
    fontVariant: ['tabular-nums'],
  },
  snapshotResultAccuracy: {
    fontSize: 12,
    color: '#666',
  },
});
