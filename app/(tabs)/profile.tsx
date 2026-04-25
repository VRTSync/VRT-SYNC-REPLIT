import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image, ImageBackground,
  ActivityIndicator, Switch, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, getNotificationPreferences, setNotificationPreferences, type NotificationPreferences } from '@/client/contexts/AuthContext';
import StatusBarFill from '@/components/StatusBarFill';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useOfflinePack } from '@/client/contexts/OfflinePackContext';
import AccountDetailsCard from '@/components/AccountDetailsCard';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { communities, activeCommunity, setActiveCommunity } = useCommunity();
  const { localPack, serverPackInfo, isDownloading, downloadProgress, hasUpdate, downloadPack, deletePack, refreshServerInfo } = useOfflinePack();
  const [showCommunities, setShowCommunities] = useState(false);
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
          <Text style={styles.role}>{user?.role === 'admin' ? 'Administrator' : 'Contractor'}</Text>
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
              <Text style={styles.noCommunities}>Not a member of any community yet</Text>
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

      {activeCommunity && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLeft}>
              <Ionicons name="cloud-download-outline" size={20} color="#25C1AC" />
              <Text style={styles.sectionTitle}>Offline Map Pack</Text>
            </View>
          </View>

          <View style={styles.packContent}>
            <Text style={styles.packCommunity}>{activeCommunity.name}</Text>

            {!serverPackInfo && !localPack && (
              <Text style={styles.packStatus}>No offline pack available for this community.</Text>
            )}

            {serverPackInfo && !localPack && (
              <View>
                <Text style={styles.packStatus}>Pack v{serverPackInfo.packVersion} available</Text>
                <TouchableOpacity
                  style={styles.packButton}
                  onPress={downloadPack}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="download-outline" size={18} color="#fff" />
                  )}
                  <Text style={styles.packButtonText}>
                    {isDownloading ? 'Downloading...' : 'Download Pack'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {localPack && (
              <View>
                <View style={styles.packInfoRow}>
                  <Ionicons name="checkmark-circle" size={16} color="#25C1AC" />
                  <Text style={styles.packInfoText}>
                    Downloaded v{localPack.packVersion}
                  </Text>
                </View>
                <Text style={styles.packDate}>
                  {new Date(localPack.downloadedAt).toLocaleDateString()} at{' '}
                  {new Date(localPack.downloadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {localPack.manifest?.layers && (
                  <Text style={styles.packLayers}>
                    {localPack.manifest.layers.length} map layer{localPack.manifest.layers.length !== 1 ? 's' : ''}
                    {' \u00B7 '}
                    {Object.keys(localPack.assetIndex || {}).length} asset{Object.keys(localPack.assetIndex || {}).length !== 1 ? 's' : ''}
                  </Text>
                )}

                {hasUpdate && (
                  <View style={styles.updateBanner}>
                    <Ionicons name="arrow-up-circle-outline" size={16} color="#f39c12" />
                    <Text style={styles.updateText}>Update available (v{serverPackInfo?.packVersion})</Text>
                  </View>
                )}

                <View style={styles.packActions}>
                  {hasUpdate && (
                    <TouchableOpacity
                      style={styles.packButton}
                      onPress={downloadPack}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="refresh-outline" size={18} color="#fff" />
                      )}
                      <Text style={styles.packButtonText}>
                        {isDownloading ? 'Updating...' : 'Update Pack'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.packDeleteButton}
                    onPress={() => {
                      Alert.alert('Delete Pack', 'Remove the offline pack for this community?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: deletePack },
                      ]);
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#f44336" />
                    <Text style={styles.packDeleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {isDownloading && downloadProgress ? (
              <Text style={styles.packProgress}>{downloadProgress}</Text>
            ) : null}
          </View>
        </View>
      )}

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
              <Text style={styles.notifDesc}>Get notified when you're assigned a task</Text>
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

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} testID="logout-btn">
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
  packContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  packCommunity: {
    fontSize: 13,
    fontWeight: '600',
    color: '#25C1AC',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  packStatus: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  packInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  packInfoText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
  },
  packDate: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
    marginLeft: 22,
  },
  packLayers: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    marginLeft: 22,
  },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF8E7',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  updateText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#f39c12',
  },
  packActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  packButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  packButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  packDeleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f4434640',
  },
  packDeleteText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#f44336',
  },
  packProgress: {
    fontSize: 12,
    color: '#25C1AC',
    marginTop: 8,
    fontStyle: 'italic',
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
});
