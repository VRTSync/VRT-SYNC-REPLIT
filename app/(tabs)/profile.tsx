import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Alert, Image,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { communities, activeCommunity, setActiveCommunity } = useCommunity();
  const insets = useSafeAreaInsets();
  const [showCommunities, setShowCommunities] = useState(false);

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView
      style={[styles.container, Platform.OS === 'web' && { paddingTop: 67 + insets.top }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.profileCard}>
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

      <View style={styles.section}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => setShowCommunities(!showCommunities)}
        >
          <View style={styles.sectionLeft}>
            <SymbolView name="building.2" size={20} tintColor="#25C1AC" />
            <Text style={styles.sectionTitle}>Communities</Text>
          </View>
          <SymbolView
            name={showCommunities ? 'chevron.up' : 'chevron.down'}
            size={14}
            tintColor="#999"
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
                    <SymbolView name="checkmark.circle.fill" size={18} tintColor="#25C1AC" />
                  )}
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} testID="logout-btn">
        <SymbolView name="rectangle.portrait.and.arrow.right" size={20} tintColor="#f44336" />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { padding: 20, paddingBottom: 100 },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  logo: { width: 140, height: 40, marginBottom: 16 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0C1D31',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
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
});
