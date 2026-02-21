import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';

type Task = {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  latitude: number | null;
  longitude: number | null;
  address: string | null;
};

const priorityColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  urgent: '#9c27b0',
};

export default function MapScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [NativeMapComponent, setNativeMapComponent] = useState<React.ComponentType<any> | null>(null);

  const communityId = activeCommunity?.id;
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['/api/tasks', { communityId }],
    queryFn: async () => {
      const route = communityId ? `/api/tasks?communityId=${communityId}` : '/api/tasks';
      const res = await apiRequest('GET', route);
      return res.json();
    },
    enabled: !!activeCommunity,
  });

  const geoTasks = tasks.filter((t) => t.latitude != null && t.longitude != null && t.status !== 'completed');

  useEffect(() => {
    if (Platform.OS !== 'web') {
      import('@/components/NativeMap').then((mod) => {
        setNativeMapComponent(() => mod.default);
      });

      import('expo-location').then(async (Location) => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({});
          setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      });
    } else {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => {}
        );
      } catch {}
    }
  }, []);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { paddingTop: 67 + insets.top }]}>
        <View style={styles.webFallback}>
          <Ionicons name="map-outline" size={48} color="#ccc" />
          <Text style={styles.webFallbackTitle}>Map View</Text>
          <Text style={styles.webFallbackText}>
            The interactive map is available on your mobile device via Expo Go.
          </Text>
          {geoTasks.length > 0 && (
            <View style={styles.taskListFallback}>
              <Text style={styles.taskListTitle}>{geoTasks.length} Task Location{geoTasks.length !== 1 ? 's' : ''}</Text>
              {geoTasks.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.taskListItem}
                  onPress={() => router.push(`/task/${t.id}`)}
                >
                  <View style={[styles.priorityDot, { backgroundColor: priorityColors[t.priority] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskListItemTitle}>{t.title}</Text>
                    {t.address && <Text style={styles.taskListItemAddr}>{t.address}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="#999" />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  if (!NativeMapComponent) {
    return (
      <View style={[styles.container, styles.webFallback]}>
        <Text style={styles.webFallbackText}>Loading map...</Text>
      </View>
    );
  }

  const mappedTasks = geoTasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    latitude: t.latitude!,
    longitude: t.longitude!,
    address: t.address,
  }));

  return (
    <NativeMapComponent
      tasks={mappedTasks}
      userLocation={userLocation}
      onTaskPress={(taskId: string) => router.push(`/task/${taskId}`)}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  webFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  webFallbackTitle: { fontSize: 20, fontWeight: '600', color: '#666', marginTop: 12 },
  webFallbackText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 8 },
  taskListFallback: { width: '100%', marginTop: 24 },
  taskListTitle: { fontSize: 16, fontWeight: '600', color: '#0C1D31', marginBottom: 12 },
  taskListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  taskListItemTitle: { fontSize: 15, fontWeight: '500', color: '#0C1D31' },
  taskListItemAddr: { fontSize: 12, color: '#888', marginTop: 2 },
});
