import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/client/contexts/AuthContext';
import { apiRequest } from '@/lib/query-client';
import Toast from '@/components/Toast';
import { useToast } from '@/hooks/useToast';

type EditMode = 'confirmPassword' | 'displayName' | 'password' | null;

const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export default function AccountDetailsCard() {
  const { user, updateProfile } = useAuth();
  const { showToast, toastProps } = useToast();
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [saving, setSaving] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState('');

  const lastVerifiedAt = useRef<number | null>(null);
  const verifiedPassword = useRef<string>('');

  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const clearErrors = () => {
    setFieldErrors({});
    setBannerError('');
  };

  const setFieldError = (field: string, message: string) => {
    setFieldErrors(prev => ({ ...prev, [field]: message }));
  };

  const clearFieldError = (field: string) => {
    setFieldErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const isRecentlyVerified = () => {
    if (lastVerifiedAt.current === null) return false;
    return Date.now() - lastVerifiedAt.current < REAUTH_WINDOW_MS;
  };

  const openDisplayName = () => {
    const parts = (user?.displayName ?? '').split(' ');
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    clearErrors();

    if (isRecentlyVerified()) {
      setEditMode('displayName');
    } else {
      clearVerification();
      setConfirmPasswordInput('');
      setEditMode('confirmPassword');
    }
  };

  const openPassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    clearErrors();
    setEditMode('password');
  };

  const closeModal = () => {
    setEditMode(null);
    setSaving(false);
    setConfirmPasswordInput('');
    clearErrors();
  };

  const clearVerification = () => {
    lastVerifiedAt.current = null;
    verifiedPassword.current = '';
  };

  const confirmCurrentPassword = async () => {
    if (!confirmPasswordInput) {
      setFieldError('confirmPasswordInput', 'Please enter your current password.');
      return;
    }
    clearErrors();
    setSaving(true);
    try {
      await apiRequest('POST', '/api/auth/verify-password', { currentPassword: confirmPasswordInput });
      lastVerifiedAt.current = Date.now();
      verifiedPassword.current = confirmPasswordInput;
      setConfirmPasswordInput('');
      setEditMode('displayName');
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Could not verify password.');
    } finally {
      setSaving(false);
    }
  };

  const saveDisplayName = async () => {
    const combined = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
    if (!combined) {
      setFieldError('firstName', 'Display name cannot be empty.');
      return;
    }
    if (!verifiedPassword.current) {
      lastVerifiedAt.current = null;
      setConfirmPasswordInput('');
      setBannerError('Session expired. Please re-enter your password to continue.');
      setEditMode('confirmPassword');
      return;
    }
    clearErrors();
    setSaving(true);
    try {
      await updateProfile({ displayName: combined, currentPassword: verifiedPassword.current });
      clearVerification();
      closeModal();
      showToast('Display name updated');
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to update display name.');
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    const errors: Record<string, string> = {};
    if (!currentPassword) {
      errors.currentPassword = 'Please enter your current password.';
    }
    if (newPassword.length < 6) {
      errors.newPassword = 'New password must be at least 6 characters.';
    }
    if (newPassword && newPassword !== confirmPassword) {
      errors.confirmPassword = 'New passwords do not match.';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    clearErrors();
    setSaving(true);
    try {
      await updateProfile({ currentPassword, newPassword });
      closeModal();
      showToast('Password updated');
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  };

  const getModalTitle = () => {
    if (editMode === 'confirmPassword') return 'Confirm Identity';
    if (editMode === 'displayName') return 'Edit Name';
    return 'Change Password';
  };

  const handleSave = () => {
    if (editMode === 'confirmPassword') return confirmCurrentPassword();
    if (editMode === 'displayName') return saveDisplayName();
    return savePassword();
  };

  return (
    <>
      <Toast {...toastProps} />
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
              <Text style={styles.modalTitle}>{getModalTitle()}</Text>
              <TouchableOpacity
                onPress={handleSave}
                style={styles.saveBtn}
                disabled={saving}
                testID="modal-save-btn"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#25C1AC" />
                ) : (
                  <Text style={styles.saveText}>
                    {editMode === 'confirmPassword' ? 'Continue' : 'Save'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {!!bannerError && (
              <View style={styles.errorBanner} testID="error-banner">
                <Ionicons name="alert-circle-outline" size={16} color="#fff" />
                <Text style={styles.errorBannerText}>{bannerError}</Text>
              </View>
            )}

            {editMode === 'confirmPassword' && (
              <View style={styles.fields}>
                <Text style={styles.confirmHint}>
                  To edit your display name, please confirm your current password.
                </Text>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Current Password</Text>
                  <TextInput
                    style={[styles.input, !!fieldErrors.confirmPasswordInput && styles.inputError]}
                    value={confirmPasswordInput}
                    onChangeText={(v) => { setConfirmPasswordInput(v); clearFieldError('confirmPasswordInput'); }}
                    placeholder="Enter your password"
                    placeholderTextColor="#bbb"
                    secureTextEntry
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={confirmCurrentPassword}
                    testID="confirm-identity-password-input"
                  />
                  {!!fieldErrors.confirmPasswordInput && (
                    <Text style={styles.fieldError} testID="confirm-identity-password-error">
                      {fieldErrors.confirmPasswordInput}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {editMode === 'displayName' && (
              <View style={styles.fields}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>First Name</Text>
                  <TextInput
                    style={[styles.input, !!fieldErrors.firstName && styles.inputError]}
                    value={firstName}
                    onChangeText={(v) => { setFirstName(v); clearFieldError('firstName'); }}
                    placeholder="First name"
                    placeholderTextColor="#bbb"
                    autoCapitalize="words"
                    returnKeyType="next"
                    testID="first-name-input"
                  />
                  {!!fieldErrors.firstName && (
                    <Text style={styles.fieldError} testID="first-name-error">
                      {fieldErrors.firstName}
                    </Text>
                  )}
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
                    style={[styles.input, !!fieldErrors.currentPassword && styles.inputError]}
                    value={currentPassword}
                    onChangeText={(v) => { setCurrentPassword(v); clearFieldError('currentPassword'); }}
                    placeholder="Enter current password"
                    placeholderTextColor="#bbb"
                    secureTextEntry
                    returnKeyType="next"
                    testID="current-password-input"
                  />
                  {!!fieldErrors.currentPassword && (
                    <Text style={styles.fieldError} testID="current-password-error">
                      {fieldErrors.currentPassword}
                    </Text>
                  )}
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>New Password</Text>
                  <TextInput
                    style={[styles.input, !!fieldErrors.newPassword && styles.inputError]}
                    value={newPassword}
                    onChangeText={(v) => { setNewPassword(v); clearFieldError('newPassword'); }}
                    placeholder="At least 6 characters"
                    placeholderTextColor="#bbb"
                    secureTextEntry
                    returnKeyType="next"
                    testID="new-password-input"
                  />
                  {!!fieldErrors.newPassword && (
                    <Text style={styles.fieldError} testID="new-password-error">
                      {fieldErrors.newPassword}
                    </Text>
                  )}
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Confirm New Password</Text>
                  <TextInput
                    style={[styles.input, !!fieldErrors.confirmPassword && styles.inputError]}
                    value={confirmPassword}
                    onChangeText={(v) => { setConfirmPassword(v); clearFieldError('confirmPassword'); }}
                    placeholder="Repeat new password"
                    placeholderTextColor="#bbb"
                    secureTextEntry
                    returnKeyType="done"
                    onSubmitEditing={savePassword}
                    testID="confirm-password-input"
                  />
                  {!!fieldErrors.confirmPassword && (
                    <Text style={styles.fieldError} testID="confirm-password-error">
                      {fieldErrors.confirmPassword}
                    </Text>
                  )}
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
  saveBtn: { paddingVertical: 4, paddingHorizontal: 4, minWidth: 60, alignItems: 'flex-end' },
  saveText: { fontSize: 16, fontWeight: '600', color: '#25C1AC' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E53935',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
    lineHeight: 18,
  },
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
  inputError: {
    borderColor: '#E53935',
  },
  fieldError: {
    fontSize: 13,
    color: '#E53935',
    marginTop: 2,
  },
  confirmHint: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 4,
  },
});
