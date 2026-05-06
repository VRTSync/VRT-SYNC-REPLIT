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

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'contractor' | 'admin'>('contractor');
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

  const handleRegister = async () => {
    const errors: Record<string, string> = {};
    if (!displayName.trim()) errors.displayName = 'Display name is required.';
    if (!username.trim()) errors.username = 'Username is required.';
    if (!password.trim()) errors.password = 'Password is required.';
    else if (password.length < 6) errors.password = 'Password must be at least 6 characters.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setBannerError('');
    setLoading(true);
    try {
      await register(username.trim(), password, displayName.trim(), role);
    } catch (e: any) {
      setBannerError(e.message || 'Could not create account. Please try again.');
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
          <Text style={styles.subtitle}>Create Account</Text>
        </View>

        <View style={styles.formCard}>
          {!!bannerError && (
            <View style={styles.errorBanner} testID="register-error-banner">
              <Ionicons name="alert-circle-outline" size={16} color="#fff" />
              <Text style={styles.errorBannerText}>{bannerError}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View style={styles.fieldWrap}>
              <TextInput
                style={[styles.input, !!fieldErrors.displayName && styles.inputError]}
                placeholder="Display Name"
                placeholderTextColor="#999"
                value={displayName}
                onChangeText={(v) => { setDisplayName(v); clearFieldError('displayName'); }}
                testID="register-displayname"
              />
              {!!fieldErrors.displayName && (
                <Text style={styles.fieldError} testID="register-displayname-error">
                  {fieldErrors.displayName}
                </Text>
              )}
            </View>

            <View style={styles.fieldWrap}>
              <TextInput
                style={[styles.input, !!fieldErrors.username && styles.inputError]}
                placeholder="Username"
                placeholderTextColor="#999"
                value={username}
                onChangeText={(v) => { setUsername(v); clearFieldError('username'); }}
                autoCapitalize="none"
                autoCorrect={false}
                testID="register-username"
              />
              {!!fieldErrors.username && (
                <Text style={styles.fieldError} testID="register-username-error">
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
                onSubmitEditing={handleRegister}
                testID="register-password"
              />
              {!!fieldErrors.password && (
                <Text style={styles.fieldError} testID="register-password-error">
                  {fieldErrors.password}
                </Text>
              )}
            </View>

            <View style={styles.roleContainer}>
              <Text style={styles.roleLabel}>Role</Text>
              <View style={styles.roleButtons}>
                <TouchableOpacity
                  style={[styles.roleButton, role === 'contractor' && styles.roleButtonActive]}
                  onPress={() => setRole('contractor')}
                >
                  <Text style={[styles.roleButtonText, role === 'contractor' && styles.roleButtonTextActive]}>
                    Contractor
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleButton, role === 'admin' && styles.roleButtonActive]}
                  onPress={() => setRole('admin')}
                >
                  <Text style={[styles.roleButtonText, role === 'admin' && styles.roleButtonTextActive]}>
                    Admin
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
              testID="register-submit"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.back()} testID="go-login">
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkBold}>Sign In</Text>
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
  logo: { width: 200, height: 55, marginBottom: 8 },
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
  roleContainer: { gap: 8 },
  roleLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  roleButtons: { flexDirection: 'row', gap: 12 },
  roleButton: {
    flex: 1,
    padding: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    backgroundColor: '#F5F7FA',
  },
  roleButtonActive: { borderColor: '#25C1AC', backgroundColor: '#E6F9F6' },
  roleButtonText: { fontSize: 14, fontWeight: '600', color: '#666' },
  roleButtonTextActive: { color: '#25C1AC' },
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
