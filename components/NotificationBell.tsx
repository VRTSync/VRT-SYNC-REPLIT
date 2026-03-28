import React, { useEffect } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { subtitleStyles } from '@/components/NavyHeader';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';

function BellIcon({ hasNotifications }: { hasNotifications: boolean }) {
  const color = '#0C1D31';
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      {hasNotifications ? (
        <>
          <Path
            d="M12 2a1 1 0 0 1 1 1v.55A7 7 0 0 1 19 10.5v3.17l1.7 2.55A1 1 0 0 1 19.87 18H4.13a1 1 0 0 1-.83-1.55L5 13.67V10.5A7 7 0 0 1 11 3.55V3a1 1 0 0 1 1-1Z"
            fill={color}
          />
          <Path
            d="M9.27 20a3 3 0 0 0 5.46 0H9.27Z"
            fill={color}
          />
          <Circle cx={18} cy={5} r={4} fill="#25C1AC" />
        </>
      ) : (
        <>
          <Path
            d="M12 2a1 1 0 0 1 1 1v.55A7 7 0 0 1 19 10.5v3.17l1.7 2.55A1 1 0 0 1 19.87 18H4.13a1 1 0 0 1-.83-1.55L5 13.67V10.5A7 7 0 0 1 11 3.55V3a1 1 0 0 1 1-1Z"
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <Path
            d="M9.27 20a3 3 0 0 0 5.46 0H9.27Z"
            fill={color}
          />
        </>
      )}
    </Svg>
  );
}

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
      <View style={subtitleStyles.headerIconBtn}>
        <Animated.View style={animatedStyle}>
          <BellIcon hasNotifications={count > 0} />
        </Animated.View>
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    position: 'relative' as const,
  },
  badge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    backgroundColor: '#FF3B30',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800' as const,
    lineHeight: 11,
  },
});
