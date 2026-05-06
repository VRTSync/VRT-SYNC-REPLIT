import React from 'react';
import { View, ImageBackground, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function StatusBarFill() {
  const insets = useSafeAreaInsets();
  const height = Platform.OS === 'web' ? 67 + insets.top : insets.top;

  if (height <= 0) return null;

  return (
    <ImageBackground
      source={require('@/assets/images/topography-texture.png')}
      style={[styles.fill, { height }]}
      resizeMode="cover"
    >
      <View style={styles.overlay} />
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  fill: {
    width: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 29, 49, 0.88)',
  },
});
