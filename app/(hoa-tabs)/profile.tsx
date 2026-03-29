import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image, ImageBackground,
  Switch, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, getNotificationPreferences, setNotificationPreferences, type NotificationPreferences } from '@/client/contexts/AuthContext';
import StatusBarFill from '@/components/StatusBarFill';
import { useCommunity } from '@/client/contexts/CommunityContext';

export default function HoaProfileScreen() {
  const { user, logout } = useAuth();
  const { activeCommunity } = useCommunity();
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    taskAssigned: true,
    dueReminders: true,
    syncFailure: true,
  });

  useEffect(() => {
    getNotificationPreferences().then(setNotifPrefs);
  }, []);

  const togglePref = useCallback((key: keyof NotificationPreferences) => {
    setNotifPrefs(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      setNotificationPreferences(updated);
      return updated;
    });
  }, []);

  const doLogout = async () => {
    try {
      await logout();
    } catch {
      Alert.alert('Error', 'Could not sign out. Please try again.');
    }
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to sign out?')) {
        doLogout();
      }
      return;
    }
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: doLogout },
    ]);
  };

  return (
    <View style={styles.outerContainer}>
      <StatusBarFill />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View style={styles.profileCard}>
          <ImageBackground
            source={require('@/assets/images/topography-texture.png')}
            style={styles.textureBanner}
            resizeMode="cover"
          >
            <View style={styles.textureBannerOverlay} />
          </ImageBackground>
          <View style={styles.profileCardContent}>
            <Image
              source={require('@/assets/images/vrtsync-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user?.displayName?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
            <Text style={styles.name}>{user?.displayName}</Text>
            <Text style={styles.role}>HOA Admin</Text>
            <Text style={styles.username}>@{user?.username}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLeft}>
              <Ionicons name="business-outline" size={20} color="#25C1AC" />
              <Text style={styles.sectionTitle}>Community</Text>
            </View>
          </View>
          <View style={styles.communityContent}>
            <Text style={styles.communityName}>{activeCommunity?.name ?? '—'}</Text>
          </View>
        </View>

        {Platform.OS !== 'web' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionLeft}>
                <Ionicons name="notifications-outline" size={20} color="#25C1AC" />
                <Text style={styles.sectionTitle}>Notifications</Text>
              </View>
            </View>

            <View style={styles.notifRow}>
              <View style={styles.notifInfo}>
                <Text style={styles.notifLabel}>New task assigned</Text>
                <Text style={styles.notifDesc}>Get notified when a task is assigned</Text>
              </View>
              <Switch
                value={notifPrefs.taskAssigned}
                onValueChange={() => togglePref('taskAssigned')}
                trackColor={{ false: '#ddd', true: '#25C1AC' }}
                thumbColor="#fff"
              />
            </View>

            <View style={styles.notifRow}>
              <View style={styles.notifInfo}>
                <Text style={styles.notifLabel}>Due reminders</Text>
                <Text style={styles.notifDesc}>Daily reminder for tasks due today</Text>
              </View>
              <Switch
                value={notifPrefs.dueReminders}
                onValueChange={() => togglePref('dueReminders')}
                trackColor={{ false: '#ddd', true: '#25C1AC' }}
                thumbColor="#fff"
              />
            </View>

            <View style={styles.notifRow}>
              <View style={styles.notifInfo}>
                <Text style={styles.notifLabel}>Sync failure alerts</Text>
                <Text style={styles.notifDesc}>Alert when a completion fails to sync</Text>
              </View>
              <Switch
                value={notifPrefs.syncFailure}
                onValueChange={() => togglePref('syncFailure')}
                trackColor={{ false: '#ddd', true: '#25C1AC' }}
                thumbColor="#fff"
              />
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} testID="hoa-logout-btn">
          <Ionicons name="log-out-outline" size={20} color="#f44336" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#f5f7fa' },
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { padding: 20, paddingBottom: 100 },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  textureBanner: {
    height: 80,
    width: '100%',
  },
  textureBannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 29, 49, 0.75)',
  },
  profileCardContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
    marginTop: -36,
  },
  logo: { width: 140, height: 40, marginBottom: 8, marginTop: 44 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0C1D31',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 3,
    borderColor: '#fff',
  },
  avatarText: { fontSize: 28, fontWeight: '700' as const, color: '#fff' },
  name: { fontSize: 20, fontWeight: '700' as const, color: '#0C1D31' },
  role: { fontSize: 14, color: '#25C1AC', fontWeight: '500' as const, marginTop: 4 },
  username: { fontSize: 13, color: '#999', marginTop: 2 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginTop: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: 16,
  },
  sectionLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600' as const, color: '#0C1D31' },
  communityContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  communityName: { fontSize: 15, color: '#444', fontWeight: '500' as const },
  logoutButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  logoutText: { fontSize: 16, fontWeight: '600' as const, color: '#f44336' },
  notifRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  notifInfo: { flex: 1, marginRight: 12 },
  notifLabel: { fontSize: 15, fontWeight: '600' as const, color: '#1a1a1a' },
  notifDesc: { fontSize: 12, color: '#888', marginTop: 2 },
});
