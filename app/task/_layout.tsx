import { Stack, useRouter } from 'expo-router';
import { TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React from 'react';

export default function TaskLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Stack
      screenOptions={{
        headerStyle: Platform.OS === 'web' ? { height: 56 + 67 + insets.top } : undefined,
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 8 }}>
            <Ionicons name="arrow-back" size={24} color="#0C1D31" />
          </TouchableOpacity>
        ),
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Task Details' }} />
    </Stack>
  );
}
