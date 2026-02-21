import React, { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getQueryFn } from '@/lib/query-client';
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
  const mapRef = useRef<MapView>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['/api/tasks', activeCommunity?.id ? `?communityId=${activeCommunity.id}` : ''],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!activeCommunity,
  });

  const geoTasks = tasks.filter((t) => t.latitude != null && t.longitude != null && t.status !== 'completed');

  useEffect(() => {
    (async () => {
      if (Platform.OS === 'web') {
        try {
          navigator.geolocation.getCurrentPosition(
            (pos) => setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            () => {}
          );
        } catch {}
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    })();
  }, []);

  useEffect(() => {
    if (geoTasks.length > 0 && mapRef.current) {
      const coords = geoTasks.map((t) => ({
        latitude: t.latitude!,
        longitude: t.longitude!,
      }));
      if (userLocation) coords.push(userLocation);
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 40, bottom: 80, left: 40 },
          animated: true,
        });
      }, 500);
    }
  }, [geoTasks.length, userLocation]);

  const initialRegion = userLocation
    ? { ...userLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 39.8283, longitude: -98.5795, latitudeDelta: 30, longitudeDelta: 30 };

  return (
    <View style={[styles.container, Platform.OS === 'web' && { paddingTop: 67 + insets.top }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
      >
        {geoTasks.map((task) => (
          <Marker
            key={task.id}
            coordinate={{ latitude: task.latitude!, longitude: task.longitude! }}
            pinColor={priorityColors[task.priority]}
          >
            <Callout onPress={() => router.push(`/task/${task.id}`)}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{task.title}</Text>
                {task.address ? <Text style={styles.calloutAddress}>{task.address}</Text> : null}
                <Text style={styles.calloutAction}>Tap to view details</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      <View style={styles.legend}>
        {Object.entries(priorityColors).map(([label, color]) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  callout: { width: 200, padding: 4 },
  calloutTitle: { fontSize: 14, fontWeight: '600', color: '#222' },
  calloutAddress: { fontSize: 12, color: '#666', marginTop: 2 },
  calloutAction: { fontSize: 11, color: '#1a73e8', marginTop: 4, fontWeight: '500' },
  legend: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#666', textTransform: 'capitalize' },
});
