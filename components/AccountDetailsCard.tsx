import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/client/contexts/AuthContext';

type EditMode = 'displayName' | 'password' | null;

export default function AccountDetailsCard() {
  const { user, updateProfile } = useAuth();
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const openDisplayName = () => {
    const parts = (user?.displayName ?? '').split(' ');
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    setEditMode('displayName');
  };

  const openPassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setEditMode('password');
  };

  const closeModal = () => {
    setEditMode(null);
    setSaving(false);
  };

  const saveDisplayName = async () => {
    const combined = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
    if (!combined) {
      Alert.alert('Validation', 'Display name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ displayName: combined });
      closeModal();
      Alert.alert('Success', 'Display name updated successfully.');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update display name.');
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    if (!currentPassword) {
      Alert.alert('Validation', 'Please enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Validation', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Validation', 'New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ currentPassword, newPassword });
      closeModal();
      Alert.alert('Success', 'Password updated successfully.');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionLeft}>
            <Ionicons name="person-circle-outline" size={20} color="#25C1AC" />
            <Text style={styles.sectionTitle}>Account Details</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.row}
          onPress={openDisplayName}
          testID="edit-display-name-row"
        >
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Display Name</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{user?.displayName ?? '—'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, styles.rowLast]}
          onPress={openPassword}
          testID="change-password-row"
        >
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Password</Text>
            <Text style={styles.rowValue}>••••••••</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </TouchableOpacity>
      </View>

      <Modal
        visible={editMode !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeModal} style={styles.cancelBtn} testID="modal-cancel-btn">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editMode === 'displayName' ? 'Edit Name' : 'Change Password'}
              </Text>
              <TouchableOpacity
                onPress={editMode === 'displayName' ? saveDisplayName : savePassword}
                style={styles.saveBtn}
                disabled={saving}
                testID="modal-save-btn"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#25C1AC" />
                ) : (
                  <Text style={styles.saveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            {editMode === 'displayName' && (
              <View style={styles.fields}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>First Name</Text>
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First name"
                    placeholderTextColor="#bbb"
                    autoCapitalize="words"
                    returnKeyType="next"
                    testID="first-name-input"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Last Name</Text>
                  <TextInput
                    style={styles.input}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last name"
                    placeholderTextColor="#bbb"
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={saveDisplayName}
                    testID="last-name-input"
                  />
                </View>
              </View>
            )}

            {editMode === 'password' && (
              <View style={styles.fields}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Current Password</Text>
                  <TextInput
                    style={styles.input}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="Enter current password"
                    placeholderTextColor="#bbb"
                    secureTextEntry
                    returnKeyType="next"
                    testID="current-password-input"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>New Password</Text>
                  <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="At least 6 characters"
                    placeholderTextColor="#bbb"
                    secureTextEntry
                    returnKeyType="next"
                    testID="new-password-input"
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Confirm New Password</Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Repeat new password"
                    placeholderTextColor="#bbb"
                    secureTextEntry
                    returnKeyType="done"
                    onSubmitEditing={savePassword}
                    testID="confirm-password-input"
                  />
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  rowLast: {},
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 13, color: '#888', marginBottom: 2 },
  rowValue: { fontSize: 15, fontWeight: '500', color: '#0C1D31' },
  modalRoot: { flex: 1, backgroundColor: '#f5f7fa' },
  modalContent: { flexGrow: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 67 : 20,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#0C1D31' },
  cancelBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  cancelText: { fontSize: 16, color: '#888' },
  saveBtn: { paddingVertical: 4, paddingHorizontal: 4, minWidth: 50, alignItems: 'flex-end' },
  saveText: { fontSize: 16, fontWeight: '600', color: '#25C1AC' },
  fields: { padding: 20, gap: 16 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0C1D31',
  },
});
