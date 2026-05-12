import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import { useCommunity } from '@/client/contexts/CommunityContext';

export default function McWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { communities, setActiveCommunity } = useCommunity();

  const community = communities.find((c) => c.id === id) ?? null;

  useEffect(() => {
    if (community) {
      setActiveCommunity(community);
    }
  }, [community?.id]);

  if (!community) {
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <View style={styles.headerBar}>
          <TouchableOpacity
            onPress={() => router.replace('/(mc-tabs)' as any)}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={22} color="#0C1D31" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Workspace</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centeredState}>
          <Ionicons name="alert-circle-outline" size={52} color="#f44336" />
          <Text style={styles.notFoundTitle}>Customer not found</Text>
          <Text style={styles.notFoundSubtitle}>
            This customer may have been removed or you may not have access.
          </Text>
          <TouchableOpacity
            style={styles.backLinkBtn}
            onPress={() => router.replace('/(mc-tabs)' as any)}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={16} color="#fff" />
            <Text style={styles.backLinkBtnText}>Back to Customers</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() => router.replace('/(mc-tabs)' as any)}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color="#0C1D31" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{community.name}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="map-outline" size={36} color="#25C1AC" />
          </View>
          <Text style={styles.communityName}>{community.name}</Text>
          {community.description ? (
            <Text style={styles.communityDescription}>{community.description}</Text>
          ) : null}
        </View>

        <View style={styles.placeholderCard}>
          <Ionicons name="construct-outline" size={32} color="#d1d5db" />
          <Text style={styles.placeholderTitle}>Map workspace coming soon</Text>
          <Text style={styles.placeholderBody}>
            Map drawing tools, GPS capture, and pin placement will be available in an upcoming update (MC4+). Stay tuned!
          </Text>
        </View>

        <TouchableOpacity
          style={styles.backLinkBtn}
          onPress={() => router.replace('/(mc-tabs)' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
          <Text style={styles.backLinkBtnText}>Back to Customers</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  headerSpacer: {
    width: 30,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f0fdfb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  communityName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0C1D31',
    textAlign: 'center',
  },
  communityDescription: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  placeholderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  placeholderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9ca3af',
    textAlign: 'center',
  },
  placeholderBody: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 19,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  notFoundTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  notFoundSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  backLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignSelf: 'center',
  },
  backLinkBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
