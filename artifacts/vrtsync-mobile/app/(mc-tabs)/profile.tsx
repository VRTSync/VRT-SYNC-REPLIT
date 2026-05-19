import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ImageBackground,
  Switch, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, getNotificationPreferences, setNotificationPreferences, type NotificationPreferences } from '@/client/contexts/AuthContext';
import StatusBarFill from '@/components/StatusBarFill';
import { useCommunity } from '@/client/contexts/CommunityContext';
import AccountDetailsCard from '@/components/AccountDetailsCard';
import OtaDiagnostic from '@/components/OtaDiagnostic';
import Toast from '@/components/Toast';
import { useToast } from '@/hooks/useToast';

export default function McProfileScreen() {
  const { user, logout } = useAuth();
  const { communities, activeCommunity, setActiveCommunity } = useCommunity();
  const { showToast, toastProps } = useToast();
  const [showCommunities, setShowCommunities] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    taskAssigned: true,
    dueReminders: true,
    syncFailure: true,
    taskCompleted: true,
    requestSubmitted: true,
    requestCompleted: true,
    requestStatusUpdates: false,
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
      setConfirmLogout(false);
      showToast('Could not sign out. Please try again.');
    }
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to sign out?')) {
        doLogout();
      }
      return;
    }
    setConfirmLogout(true);
  };

  const roleLabel =
    user?.role === 'admin' ? 'Administrator' :
    user?.role === 'map_creator' ? 'Map Creator' :
    'Contractor';

  return (
    <View style={styles.outerContainer}>
      <Toast {...toastProps} />
      <StatusBarFill />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

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
            <Text style={styles.role}>{roleLabel}</Text>
            <Text style={styles.username}>@{user?.username}</Text>
          </View>
        </View>

        <AccountDetailsCard />

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setShowCommunities(!showCommunities)}
          >
            <View style={styles.sectionLeft}>
              <Ionicons name="business-outline" size={20} color="#25C1AC" />
              <Text style={styles.sectionTitle}>Communities</Text>
            </View>
            <Ionicons
              name={showCommunities ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#999"
            />
          </TouchableOpacity>

          {showCommunities && (
            <View style={styles.communityList}>
              {communities.length === 0 ? (
                <Text style={styles.noCommunities}>No communities assigned yet</Text>
              ) : (
                communities.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.communityItem,
                      c.id === activeCommunity?.id && styles.communityItemActive,
                    ]}
                    onPress={() => setActiveCommunity(c)}
                  >
                    <Text
                      style={[
                        styles.communityName,
                        c.id === activeCommunity?.id && styles.communityNameActive,
                      ]}
                    >
                      {c.name}
                    </Text>
                    {c.id === activeCommunity?.id && (
                      <Ionicons name="checkmark-circle" size={18} color="#25C1AC" />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}
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

            <View style={styles.notifRow}>
              <View style={styles.notifInfo}>
                <Text style={styles.notifLabel}>Task completed</Text>
                <Text style={styles.notifDesc}>When a contractor marks a task done</Text>
              </View>
              <Switch
                value={notifPrefs.taskCompleted}
                onValueChange={() => togglePref('taskCompleted')}
                trackColor={{ false: '#ddd', true: '#25C1AC' }}
                thumbColor="#fff"
              />
            </View>

            <View style={styles.notifRow}>
              <View style={styles.notifInfo}>
                <Text style={styles.notifLabel}>Request submitted</Text>
                <Text style={styles.notifDesc}>When a resident submits a new HOA request</Text>
              </View>
              <Switch
                value={notifPrefs.requestSubmitted}
                onValueChange={() => togglePref('requestSubmitted')}
                trackColor={{ false: '#ddd', true: '#25C1AC' }}
                thumbColor="#fff"
              />
            </View>
          </View>
        )}

        <OtaDiagnostic />

        {!confirmLogout ? (
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} testID="mc-logout-btn">
            <Ionicons name="log-out-outline" size={20} color="#f44336" />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.logoutConfirmCard}>
            <Text style={styles.logoutConfirmQuestion}>Are you sure you want to sign out?</Text>
            <View style={styles.logoutConfirmButtons}>
              <TouchableOpacity
                style={styles.logoutCancelBtn}
                onPress={() => setConfirmLogout(false)}
                testID="mc-logout-cancel-btn"
              >
                <Text style={styles.logoutCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.logoutConfirmBtn}
                onPress={doLogout}
                testID="mc-logout-confirm-btn"
              >
                <Text style={styles.logoutConfirmBtnText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
  avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  name: { fontSize: 20, fontWeight: '700', color: '#0C1D31' },
  role: { fontSize: 14, color: '#25C1AC', fontWeight: '500', marginTop: 4 },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#0C1D31' },
  communityList: { paddingHorizontal: 16, paddingBottom: 12 },
  noCommunities: { fontSize: 14, color: '#999', paddingVertical: 8 },
  communityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  communityItemActive: { backgroundColor: '#E6F9F6' },
  communityName: { fontSize: 15, color: '#444' },
  communityNameActive: { color: '#25C1AC', fontWeight: '600' },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  notifInfo: { flex: 1, marginRight: 12 },
  notifLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  notifDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  updateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 20,
    marginBottom: 4,
  },
  updateBadgeText: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '500',
  },
  updateBadgeTextOta: {
    color: '#25C1AC',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  logoutText: { fontSize: 16, fontWeight: '600', color: '#f44336' },
  logoutConfirmCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    gap: 16,
  },
  logoutConfirmQuestion: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
  },
  logoutConfirmButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  logoutCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  logoutCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  logoutConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f44336',
    alignItems: 'center',
  },
  logoutConfirmBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
