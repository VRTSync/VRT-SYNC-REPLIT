import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  Platform, Alert,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { ServiceSchedule } from '@/client/contexts/OfflineContext';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Props = {
  visible: boolean;
  schedule: ServiceSchedule | null;
  onClose: () => void;
  onSubmit: (data: {
    id: string;
    scheduleId: string;
    communityId: string;
    serviceDate: string;
    employeeSignOffName: string;
    notes: string | null;
    completedAt: string;
  }) => void;
  userName?: string;
  prefillDate?: string;
};

export default function LogVisitModal({ visible, schedule, onClose, onSubmit, userName, prefillDate }: Props) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [serviceDate, setServiceDate] = useState(prefillDate || todayStr);
  const [signOffName, setSignOffName] = useState(userName || '');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (visible && userName && !signOffName) {
      setSignOffName(userName);
    }
    if (visible && prefillDate) {
      setServiceDate(prefillDate);
    }
  }, [visible, userName, prefillDate]);

  const resetForm = () => {
    setServiceDate(todayStr);
    setSignOffName(userName || '');
    setNotes('');
    setSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (!schedule) return;
    if (!signOffName.trim()) {
      Alert.alert('Required', 'Please enter your name for sign-off.');
      return;
    }
    if (!serviceDate) {
      Alert.alert('Required', 'Please enter a service date.');
      return;
    }

    setSubmitting(true);
    try {
      const id = Crypto.randomUUID();
      onSubmit({
        id,
        scheduleId: schedule.id,
        communityId: schedule.communityId,
        serviceDate,
        employeeSignOffName: signOffName.trim(),
        notes: notes.trim() || null,
        completedAt: new Date().toISOString(),
      });
      resetForm();
      onClose();
    } catch (e) {
      setSubmitting(false);
    }
  };

  if (!schedule) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.keyboardView}>
          <View style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Ionicons name="leaf" size={20} color="#27ae60" />
                <Text style={styles.headerTitle}>Log Service Visit</Text>
              </View>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>

            <View style={styles.scheduleInfo}>
              <Text style={styles.scheduleLabel}>
                {schedule.serviceType === 'mowing' ? 'Mowing' : schedule.serviceType}
                {' — '}
                {DAY_NAMES[schedule.dayOfWeek]}s
              </Text>
            </View>

            <KeyboardAwareScrollViewCompat style={styles.form} bottomOffset={20}>
              <Text style={styles.fieldLabel}>Service Date</Text>
              <TextInput
                style={styles.input}
                value={serviceDate}
                onChangeText={setServiceDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#ccc"
                testID="visit-date-input"
              />

              <Text style={styles.fieldLabel}>Your Name (Sign-off)</Text>
              <TextInput
                style={styles.input}
                value={signOffName}
                onChangeText={setSignOffName}
                placeholder="Enter your name"
                placeholderTextColor="#ccc"
                testID="visit-signoff-input"
              />

              <Text style={styles.fieldLabel}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Any notes about this visit..."
                placeholderTextColor="#ccc"
                multiline
                numberOfLines={3}
                testID="visit-notes-input"
              />
            </KeyboardAwareScrollViewCompat>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.7}
              testID="visit-submit-btn"
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.submitBtnText}>
                {submitting ? 'Saving...' : 'Log Visit'}
              </Text>
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
  keyboardView: {
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
  scheduleInfo: {
    marginTop: 8,
    marginBottom: 16,
  },
  scheduleLabel: {
    fontSize: 14,
    color: '#888',
  },
  form: {
    maxHeight: 300,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0C1D31',
    marginBottom: 6,
    marginTop: 12,
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
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
