import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, Platform, Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ToastProps {
  visible: boolean;
  message: string;
  type?: 'success' | 'error';
  toastKey?: number;
}

export default function Toast({ visible, message, type = 'success', toastKey }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      opacity.setValue(0);
      const anim = Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(2200),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]);
      animRef.current = anim;
      anim.start(() => { animRef.current = null; });
    } else {
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      opacity.setValue(0);
    }
  }, [visible, toastKey]);

  if (!visible) return null;

  const bottomOffset = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.overlay} pointerEvents="none">
        <Animated.View
          style={[
            styles.container,
            { opacity, bottom: bottomOffset + 24, backgroundColor: type === 'error' ? '#c62828' : '#1a2e44' },
          ]}
        >
          <Text style={styles.text}>{message}</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    position: 'relative',
  },
  container: {
    position: 'absolute',
    left: 24,
    right: 24,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 8,
  },
  text: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
