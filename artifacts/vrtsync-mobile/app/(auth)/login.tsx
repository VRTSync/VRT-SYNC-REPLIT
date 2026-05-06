import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Image, ImageBackground,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/client/contexts/AuthContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState('');

  const clearFieldError = (field: string) => {
    setFieldErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleLogin = async () => {
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = 'Username is required.';
    if (!password.trim()) errors.password = 'Password is required.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setBannerError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (e: any) {
      setBannerError(e.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ImageBackground
      source={require('@/assets/images/topography-texture-rotated.png')}
      style={styles.backgroundImage}
      imageStyle={styles.imageStyle}
      resizeMode="repeat"
    >
      <View style={styles.overlay} />
      <KeyboardAwareScrollViewCompat
        style={styles.container}
        contentContainerStyle={[styles.inner, { paddingTop: Platform.OS === 'web' ? 67 + insets.top : insets.top }]}
        bottomOffset={40}
      >
        <View style={styles.header}>
          <Image
            source={require('@/assets/images/vrtsync-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.subtitle}>VRTSync Mobile Portal</Text>
        </View>

        <View style={styles.formCard}>
          {!!bannerError && (
            <View style={styles.errorBanner} testID="login-error-banner">
              <Ionicons name="alert-circle-outline" size={16} color="#fff" />
              <Text style={styles.errorBannerText}>{bannerError}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View style={styles.fieldWrap}>
              <TextInput
                style={[styles.input, !!fieldErrors.username && styles.inputError]}
                placeholder="Username"
                placeholderTextColor="#999"
                value={username}
                onChangeText={(v) => { setUsername(v); clearFieldError('username'); }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                testID="login-username"
              />
              {!!fieldErrors.username && (
                <Text style={styles.fieldError} testID="login-username-error">
                  {fieldErrors.username}
                </Text>
              )}
            </View>

            <View style={styles.fieldWrap}>
              <TextInput
                style={[styles.input, !!fieldErrors.password && styles.inputError]}
                placeholder="Password"
                placeholderTextColor="#999"
                value={password}
                onChangeText={(v) => { setPassword(v); clearFieldError('password'); }}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                testID="login-password"
              />
              {!!fieldErrors.password && (
                <Text style={styles.fieldError} testID="login-password-error">
                  {fieldErrors.password}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              testID="login-submit"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push('/(auth)/register')} testID="go-register">
            <Text style={styles.linkText}>
              Don't have an account? <Text style={styles.linkBold}>Register</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1, backgroundColor: '#06101c' },
  imageStyle: {
    width: '100%',
    height: '100%',
    opacity: 0.35,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 29, 49, 0.8)',
  },
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { width: 220, height: 65, marginBottom: 8 },
  subtitle: { fontSize: 16, color: 'rgba(255,255,255,0.7)', marginTop: 4, fontWeight: '500' },
  formCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E53935',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
    lineHeight: 18,
  },
  form: { gap: 16, padding: 24, paddingBottom: 8 },
  fieldWrap: { gap: 6 },
  input: {
    backgroundColor: '#F5F7FA',
    borderRadius: 999,
    padding: 16,
    paddingHorizontal: 20,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#0C1D31',
  },
  inputError: {
    borderColor: '#E53935',
  },
  fieldError: {
    fontSize: 13,
    color: '#E53935',
    paddingHorizontal: 8,
  },
  button: {
    backgroundColor: '#25C1AC',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#25C1AC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { textAlign: 'center', color: '#666', fontSize: 14, padding: 24, paddingTop: 8 },
  linkBold: { color: '#25C1AC', fontWeight: '600' },
});
