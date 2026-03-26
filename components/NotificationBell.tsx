import React, { useEffect } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';

export default function NotificationBell() {
  const router = useRouter();

  const { data } = useQuery<{ count: number }>({
    queryKey: ['/api/notifications/unread-count'],
    refetchInterval: 30000,
  });

  const count = data?.count ?? 0;
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (count > 0) {
      rotation.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }),
          withTiming(18, { duration: 120, easing: Easing.out(Easing.quad) }),
          withTiming(-15, { duration: 220, easing: Easing.inOut(Easing.quad) }),
          withTiming(10, { duration: 180, easing: Easing.inOut(Easing.quad) }),
          withTiming(-8, { duration: 160, easing: Easing.inOut(Easing.quad) }),
          withTiming(4, { duration: 130, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 100, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 2000 }),
        ),
        -1,
        false,
      );
    } else {
      rotation.value = withTiming(0, { duration: 200 });
    }
  }, [count]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <TouchableOpacity
      onPress={() => router.push('/notifications' as any)}
      style={styles.bellBtn}
      testID="notification-bell"
    >
      <Animated.View style={animatedStyle}>
        <Ionicons name="notifications-outline" size={22} color="#fff" />
      </Animated.View>
      {count > 0 && (
        <View style={styles.badgeOuter}>
          <View style={styles.badgeInner}>
            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
          </View>
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
  badgeOuter: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    transform: [{ rotate: '30deg' }],
  },
  badgeInner: {
    backgroundColor: '#25C1AC',
    borderRadius: 5,
    minWidth: 14,
    minHeight: 14,
    paddingHorizontal: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    transform: [{ rotate: '-30deg' }],
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700' as const,
    lineHeight: 12,
  },
});
