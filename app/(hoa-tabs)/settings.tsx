import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';
import StatusBarFill from '@/components/StatusBarFill';

export default function HoaSettingsScreen() {
  const { user, logout } = useAuth();
  const { activeCommunity } = useCommunity();

  const roleLabel = user?.role === 'hoa_admin' ? 'HOA Admin' : 'HOA Member';

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      logout();
      return;
    }
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={22} color="#0C1D31" />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowValue}>{user?.displayName ?? '—'}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Ionicons name="shield-checkmark-outline" size={22} color="#0C1D31" />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Role</Text>
              <Text style={styles.rowValue}>{roleLabel}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Ionicons name="business-outline" size={22} color="#0C1D31" />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Community</Text>
              <Text style={styles.rowValue}>{activeCommunity?.name ?? '—'}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#0C1D31',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700' as const },
  content: { flex: 1, padding: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 10 },
  rowText: { marginLeft: 12, flex: 1 },
  rowLabel: { fontSize: 12, color: '#999', fontWeight: '500' as const },
  rowValue: { fontSize: 15, color: '#333', fontWeight: '500' as const, marginTop: 1 },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 2 },
  logoutButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  logoutText: { color: '#ef4444', fontSize: 15, fontWeight: '600' as const, marginLeft: 8 },
});
