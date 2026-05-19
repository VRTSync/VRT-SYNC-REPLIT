import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';

type CheckState = 'idle' | 'checking' | 'available' | 'applying' | 'upToDate' | 'error';

export default function OtaDiagnostic() {
  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCheck = async () => {
    setCheckState('checking');
    setErrorMsg(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setCheckState('available');
        setCheckState('applying');
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } else {
        setCheckState('upToDate');
      }
    } catch (e: unknown) {
      setCheckState('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const isEmbedded = Updates.isEmbeddedLaunch;
  const channel = Updates.channel ?? '—';
  const runtimeVersion = Updates.runtimeVersion ?? '—';
  const updateId = Updates.updateId;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons
          name={isEmbedded ? 'cube-outline' : 'cloud-done-outline'}
          size={14}
          color={isEmbedded ? '#9ca3af' : '#25C1AC'}
        />
        <Text style={[styles.statusText, !isEmbedded && styles.statusTextOta]}>
          {isEmbedded ? 'Embedded build' : `OTA active · ${updateId?.slice(0, 8) ?? '—'}`}
        </Text>
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Channel</Text>
          <Text style={styles.metaValue}>{channel}</Text>
        </View>
        <View style={styles.metaSep} />
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Runtime</Text>
          <Text style={styles.metaValue}>{runtimeVersion}</Text>
        </View>
      </View>

      {checkState === 'error' && errorMsg && (
        <Text style={styles.errorText} numberOfLines={3}>{errorMsg}</Text>
      )}
      {checkState === 'upToDate' && (
        <Text style={styles.upToDateText}>App is up to date</Text>
      )}

      <TouchableOpacity
        style={[styles.checkBtn, (checkState === 'checking' || checkState === 'applying') && styles.checkBtnDisabled]}
        onPress={handleCheck}
        disabled={checkState === 'checking' || checkState === 'applying'}
        activeOpacity={0.8}
      >
        {(checkState === 'checking' || checkState === 'applying') ? (
          <>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.checkBtnText}>
              {checkState === 'applying' ? 'Applying…' : 'Checking…'}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="refresh-outline" size={14} color="#fff" />
            <Text style={styles.checkBtnText}>Check for Update</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginTop: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
  },
  statusTextOta: {
    color: '#25C1AC',
  },
  metaGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 10,
  },
  metaItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  metaSep: {
    width: 1,
    height: 28,
    backgroundColor: '#e5e7eb',
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0C1D31',
  },
  errorText: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '500',
  },
  upToDateText: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '600',
    textAlign: 'center',
  },
  checkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 10,
    paddingVertical: 10,
  },
  checkBtnDisabled: {
    opacity: 0.6,
  },
  checkBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});
