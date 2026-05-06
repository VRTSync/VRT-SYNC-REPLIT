import { Stack } from 'expo-router';
import React from 'react';

export default function TaskLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
