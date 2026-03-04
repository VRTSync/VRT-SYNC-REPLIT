import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';

export default function HoaMapScreen() {
  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Map</Text>
      </View>
      <View style={styles.content}>
        <Ionicons name="map" size={48} color="#25C1AC" />
        <Text style={styles.placeholderTitle}>Map</Text>
        <Text style={styles.placeholderText}>Coming soon</Text>
      </View>
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
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700' as const },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  placeholderTitle: { fontSize: 20, fontWeight: '600' as const, color: '#333', marginTop: 12 },
  placeholderText: { fontSize: 14, color: '#999', marginTop: 4 },
});
