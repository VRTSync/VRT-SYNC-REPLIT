import { Stack, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';

export default function TaskLayout() {
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
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
