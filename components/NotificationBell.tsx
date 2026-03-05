import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

export default function NotificationBell() {
  const router = useRouter();

  const { data } = useQuery<{ count: number }>({
    queryKey: ['/api/notifications/unread-count'],
    refetchInterval: 30000,
  });

  const count = data?.count ?? 0;

  return (
    <TouchableOpacity
      onPress={() => router.push('/notifications' as any)}
      style={styles.bellBtn}
      testID="notification-bell"
    >
      <Ionicons name="notifications-outline" size={22} color="#fff" />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    padding: 8,
    position: 'relative' as const,
  },
  badge: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    backgroundColor: '#e74c3c',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700' as const,
  },
});
