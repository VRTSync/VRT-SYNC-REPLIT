import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, Platform,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiRequest } from '@/lib/query-client';
import { useCommunity, type Community } from '@/client/contexts/CommunityContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
};

export default function NewCustomerModal({ visible, onClose, onToast }: Props) {
  const router = useRouter();
  const { addCommunityOptimistic, refresh, setActiveCommunity } = useCommunity();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setName('');
    setDescription('');
    setSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const isValid = name.trim().length >= 1 && name.trim().length <= 100;

  const handleCreate = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiRequest('POST', '/api/communities', {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      const community: Community = await res.json();
      addCommunityOptimistic(community);
      setActiveCommunity(community);
      refresh();
      resetForm();
      onClose();
      router.push(`/mc-workspace/${community.id}` as any);
    } catch (e: any) {
      onToast(e.message || 'Failed to create customer', 'error');
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="add-circle-outline" size={20} color="#25C1AC" />
              <Text style={styles.headerTitle}>New Customer</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#666" />
            </TouchableOpacity>
          </View>

          <KeyboardAwareScrollViewCompat style={styles.form} bottomOffset={20}>
            <Text style={styles.fieldLabel}>
              Name <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, name.trim().length > 100 && styles.inputError]}
              value={name}
              onChangeText={setName}
              placeholder="Community or HOA name"
              placeholderTextColor="#bbb"
              maxLength={120}
              autoFocus
              returnKeyType="next"
              testID="customer-name-input"
            />
            {name.trim().length > 100 && (
              <Text style={styles.errorText}>Name must be 100 characters or fewer</Text>
            )}

            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Brief description..."
              placeholderTextColor="#bbb"
              multiline
              numberOfLines={3}
              maxLength={500}
              testID="customer-description-input"
            />
            {description.length > 0 && (
              <Text style={styles.charCount}>{description.length}/500</Text>
            )}
          </KeyboardAwareScrollViewCompat>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} disabled={submitting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.createBtn, (!isValid || submitting) && styles.createBtnDisabled]}
              onPress={handleCreate}
              disabled={!isValid || submitting}
              activeOpacity={0.7}
              testID="customer-create-btn"
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.createBtnText}>Create</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  closeBtn: {
    padding: 4,
  },
  form: {
    maxHeight: 320,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0C1D31',
    marginBottom: 6,
    marginTop: 12,
  },
  required: {
    color: '#f44336',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#fafafa',
  },
  inputError: {
    borderColor: '#f44336',
  },
  errorText: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 4,
  },
  textArea: {
    height: 90,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: '#999',
    textAlign: 'right',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  createBtn: {
    flex: 1,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
