import { Stack } from 'expo-router';
import React from 'react';

export default function TaskLayout() {
  return (
    <Stack>
      <Stack.Screen name="[id]" options={{ title: 'Task Details' }} />
    </Stack>
  );
}
