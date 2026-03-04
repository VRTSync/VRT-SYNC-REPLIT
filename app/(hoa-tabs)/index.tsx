import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';
import StatusBarFill from '@/components/StatusBarFill';
import CreateRequestSheet from '@/components/CreateRequestSheet';

export default function HoaDashboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { activeCommunity } = useCommunity();
  const isHoaAdmin = user?.role === 'hoa_admin';
  const [showCreateRequest, setShowCreateRequest] = useState(false);

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{activeCommunity?.name ?? 'Community'}</Text>
        <Text style={styles.headerSubtitle}>HOA Dashboard</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.placeholder}>
          <Ionicons name="home" size={48} color="#25C1AC" />
          <Text style={styles.placeholderTitle}>Dashboard</Text>
          <Text style={styles.placeholderText}>Coming soon</Text>
          {isHoaAdmin && (
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateRequest(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.createButtonText}>Create Request</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <CreateRequestSheet
        visible={showCreateRequest}
        onClose={() => setShowCreateRequest(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#0C1D31',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700' as const,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  placeholder: { alignItems: 'center' },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: '#333',
    marginTop: 12,
  },
  placeholderText: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
  createButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#25C1AC',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
    gap: 6,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600' as const,
  },
});
