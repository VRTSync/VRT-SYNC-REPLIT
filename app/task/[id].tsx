import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Image, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, getQueryFn, getApiUrl } from '@/lib/query-client';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useOffline } from '@/client/contexts/OfflineContext';
import { uploadFileToStorage } from '@/client/utils/objectStorageExpo';
import * as Crypto from 'expo-crypto';

type Task = {
  id: string;
  communityId: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  assignedTo: string | null;
  createdBy: string;
  dueDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type Completion = {
  id: string;
  taskId: string;
  completedBy: string;
  notes: string | null;
  employeeSignOffName: string;
  timeSpentMinutes: number | null;
  materialsUsed: string | null;
  followUpNeeded: string | null;
  completedAt: string;
  attachments: { id: string; url: string; fileRef: string; createdAt: string }[];
};

const priorityColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  urgent: '#9c27b0',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeCommunity } = useCommunity();
  const { isOnline, addPendingCompletion, getCompletionForTask, retryCompletion, dismissCompletion, syncPendingCompletions, pendingCompletions } = useOffline();
  const insets = useSafeAreaInsets();

  const [notes, setNotes] = useState('');
  const [signOffName, setSignOffName] = useState('');
  const [timeSpent, setTimeSpent] = useState('');
  const [materialsUsed, setMaterialsUsed] = useState('');
  const [followUpNeeded, setFollowUpNeeded] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);
  const [showCompleteForm, setShowCompleteForm] = useState(false);

  const { data: task, isLoading } = useQuery<Task>({
    queryKey: [`/api/tasks/${id}`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!id,
  });

  const { data: completions = [] } = useQuery<Completion[]>({
    queryKey: [`/api/tasks/${id}/completions`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!id,
  });

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
    });
    if (!result.canceled) {
      setPhotos((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your camera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
    });
    if (!result.canceled) {
      setPhotos((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleComplete = async () => {
    if (!task) return;
    if (!signOffName.trim()) {
      Alert.alert('Required', 'Please enter your sign-off name.');
      return;
    }
    setCompleting(true);

    const completionPayload = {
      version: task.version,
      notes: notes.trim() || undefined,
      employeeSignOffName: signOffName.trim(),
      timeSpentMinutes: timeSpent ? parseInt(timeSpent, 10) : undefined,
      materialsUsed: materialsUsed.trim() || undefined,
      followUpNeeded: followUpNeeded.trim() || undefined,
    };

    if (!isOnline) {
      await addPendingCompletion({
        id: Crypto.randomUUID(),
        taskId: task.id,
        version: task.version,
        notes: notes.trim() || undefined,
        employeeSignOffName: signOffName.trim(),
        completedAt: new Date().toISOString(),
        timeSpentMinutes: timeSpent ? parseInt(timeSpent, 10) : undefined,
        materialsUsed: materialsUsed.trim() || undefined,
        followUpNeeded: followUpNeeded.trim() || undefined,
        photoUris: photos,
        createdAt: new Date().toISOString(),
      });
      Alert.alert(
        'Saved Offline',
        'Your completion will be synced when you are back online.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
      setCompleting(false);
      return;
    }

    try {
      const res = await apiRequest('POST', `/api/tasks/${task.id}/complete`, completionPayload);
      const { task: updatedTask, completion } = await res.json();

      let failedUploads = 0;
      for (const photoUri of photos) {
        const idempotencyKey = Crypto.randomUUID();
        let uploaded = false;
        for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
          try {
            const file = new ExpoFile(photoUri);
            const uploadURL = await uploadFileToStorage(file);

            await apiRequest('POST', `/api/tasks/${task.id}/attachments`, {
              taskCompletionId: completion.id,
              uploadURL,
              idempotencyKey,
            });
            uploaded = true;
          } catch (uploadError) {
            console.error(`Photo upload attempt ${attempt + 1} failed:`, uploadError);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
        if (!uploaded) failedUploads++;
      }
      if (failedUploads > 0) {
        console.warn(`${failedUploads} photo(s) failed to upload after retries`);
      }

      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${id}`] });

      Alert.alert('Task Completed', 'The task has been marked as complete.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      if (e.message?.includes('409')) {
        Alert.alert(
          'Update Conflict',
          'This task was modified by someone else. Please go back and refresh to see the latest version.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else {
        Alert.alert('Error', e.message || 'Failed to complete task');
      }
    } finally {
      setCompleting(false);
    }
  };

  if (isLoading || !task) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <ActivityIndicator size="large" color="#25C1AC" />
      </View>
    );
  }

  const pendingForTask = pendingCompletions.find(c => c.taskId === id && c.state !== 'synced');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: task.title,
          headerRight: () =>
            task.status !== 'completed' && !pendingForTask ? (
              <TouchableOpacity onPress={() => setShowCompleteForm(true)}>
                <Ionicons name="checkmark-circle-outline" size={24} color="#25C1AC" />
              </TouchableOpacity>
            ) : null,
        }}
      />

      {pendingForTask && (
        <View style={[styles.offlineBanner, {
          backgroundColor: pendingForTask.state === 'failed' ? '#ffebee' : pendingForTask.state === 'syncing' ? '#e3f2fd' : '#fff3e0',
          borderColor: pendingForTask.state === 'failed' ? '#ef9a9a' : pendingForTask.state === 'syncing' ? '#90caf9' : '#ffcc80',
        }]}>
          <View style={styles.offlineBannerContent}>
            <Ionicons
              name={pendingForTask.state === 'failed' ? 'warning-outline' : pendingForTask.state === 'syncing' ? 'sync-outline' : 'time-outline'}
              size={18}
              color={pendingForTask.state === 'failed' ? '#c62828' : pendingForTask.state === 'syncing' ? '#1565c0' : '#e65100'}
            />
            <View style={styles.offlineBannerText}>
              <Text style={[styles.offlineBannerTitle, {
                color: pendingForTask.state === 'failed' ? '#c62828' : pendingForTask.state === 'syncing' ? '#1565c0' : '#e65100',
              }]}>
                {pendingForTask.state === 'failed' ? 'Sync Failed' : pendingForTask.state === 'syncing' ? 'Syncing...' : 'Completion Queued'}
              </Text>
              {pendingForTask.lastError ? (
                <Text style={styles.offlineBannerError}>{pendingForTask.lastError}</Text>
              ) : (
                <Text style={styles.offlineBannerSub}>
                  {pendingForTask.state === 'queued' ? 'Will sync when online' : 'Uploading to server...'}
                </Text>
              )}
            </View>
          </View>
          {pendingForTask.state === 'failed' && (
            <View style={styles.offlineBannerActions}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => retryCompletion(pendingForTask.id)}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={() => {
                  Alert.alert(
                    'Discard Completion',
                    'This will remove the queued completion. You can re-complete the task later.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Discard', style: 'destructive', onPress: () => dismissCompletion(pendingForTask.id) },
                    ],
                  );
                }}
              >
                <Text style={styles.dismissButtonText}>Discard</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <View style={[styles.priorityBadge, { backgroundColor: priorityColors[task.priority] }]}>
            <Text style={styles.priorityText}>{task.priority.toUpperCase()}</Text>
          </View>
          <Text style={styles.statusLabel}>{statusLabels[task.status]}</Text>
        </View>
        <Text style={styles.title}>{task.title}</Text>
        {task.description ? (
          <Text style={styles.description}>{task.description}</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Details</Text>
        {task.address ? (
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={16} color="#666" />
            <Text style={styles.detailText}>{task.address}</Text>
          </View>
        ) : null}
        {task.dueDate ? (
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={16} color="#666" />
            <Text style={styles.detailText}>Due: {new Date(task.dueDate).toLocaleDateString()}</Text>
          </View>
        ) : null}
        <View style={styles.detailRow}>
          <Ionicons name="git-branch-outline" size={16} color="#666" />
          <Text style={styles.detailText}>Version: {task.version}</Text>
        </View>
      </View>

      {completions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Completion History</Text>
          {completions.map((c) => (
            <View key={c.id} style={styles.completionItem}>
              <Text style={styles.completionDate}>
                {new Date(c.completedAt).toLocaleString()}
              </Text>
              <Text style={styles.signOffLabel}>Signed off by: {c.employeeSignOffName}</Text>
              {c.notes ? <Text style={styles.completionNotes}>{c.notes}</Text> : null}
              {c.timeSpentMinutes ? <Text style={styles.completionMeta}>Time: {c.timeSpentMinutes} min</Text> : null}
              {c.materialsUsed ? <Text style={styles.completionMeta}>Materials: {c.materialsUsed}</Text> : null}
              {c.followUpNeeded ? <Text style={styles.completionMeta}>Follow-up: {c.followUpNeeded}</Text> : null}
              {c.attachments && c.attachments.length > 0 && (
                <View style={styles.attachmentRow}>
                  {c.attachments.map((a) => (
                    <Image
                      key={a.id}
                      source={{ uri: `${getApiUrl()}${a.url}` }}
                      style={styles.attachmentThumb}
                    />
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {showCompleteForm && task.status !== 'completed' && !pendingForTask && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Complete Task</Text>

          <Text style={styles.fieldLabel}>Sign-Off Name *</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="Your full name"
            placeholderTextColor="#999"
            value={signOffName}
            onChangeText={setSignOffName}
            testID="signoff-name"
          />

          <Text style={styles.fieldLabel}>Completion Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Add completion notes..."
            placeholderTextColor="#999"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <Text style={styles.fieldLabel}>Time Spent (minutes)</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="e.g. 90"
            placeholderTextColor="#999"
            value={timeSpent}
            onChangeText={setTimeSpent}
            keyboardType="numeric"
          />

          <Text style={styles.fieldLabel}>Materials Used</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="List materials used..."
            placeholderTextColor="#999"
            value={materialsUsed}
            onChangeText={setMaterialsUsed}
          />

          <Text style={styles.fieldLabel}>Follow-Up Needed</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="Any follow-up work required?"
            placeholderTextColor="#999"
            value={followUpNeeded}
            onChangeText={setFollowUpNeeded}
          />

          <View style={styles.photoSection}>
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
                <Ionicons name="camera-outline" size={20} color="#25C1AC" />
                <Text style={styles.photoButtonText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoButton} onPress={pickPhoto}>
                <Ionicons name="image-outline" size={20} color="#25C1AC" />
                <Text style={styles.photoButtonText}>Gallery</Text>
              </TouchableOpacity>
            </View>

            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoPreview}>
                {photos.map((uri, index) => (
                  <View key={index} style={styles.photoItem}>
                    <Image source={{ uri }} style={styles.photoThumb} />
                    <TouchableOpacity
                      style={styles.removePhoto}
                      onPress={() => removePhoto(index)}
                    >
                      <Ionicons name="close-circle" size={20} color="#f44336" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          <TouchableOpacity
            style={[styles.completeButton, completing && styles.buttonDisabled]}
            onPress={handleComplete}
            disabled={completing}
          >
            {completing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.completeButtonText}>Mark as Complete</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {!showCompleteForm && task.status !== 'completed' && !pendingForTask && (
        <TouchableOpacity
          style={styles.completeButton}
          onPress={() => setShowCompleteForm(true)}
        >
          <Text style={styles.completeButtonText}>Complete This Task</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { padding: 16, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  priorityBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  statusLabel: { fontSize: 13, fontWeight: '600', color: '#888' },
  title: { fontSize: 22, fontWeight: '700', color: '#0C1D31' },
  description: { fontSize: 15, color: '#555', marginTop: 8, lineHeight: 22 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0C1D31', marginBottom: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  detailText: { fontSize: 14, color: '#555' },
  completionItem: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
    marginTop: 8,
  },
  completionDate: { fontSize: 12, color: '#999', marginBottom: 4 },
  signOffLabel: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 2 },
  completionNotes: { fontSize: 14, color: '#555' },
  completionMeta: { fontSize: 13, color: '#777', marginTop: 2 },
  attachmentRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  attachmentThumb: { width: 60, height: 60, borderRadius: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 4, marginTop: 8 },
  fieldInput: {
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#333',
    marginBottom: 4,
  },
  notesInput: {
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#333',
    minHeight: 100,
    marginBottom: 4,
  },
  photoSection: { marginBottom: 12 },
  photoButtons: { flexDirection: 'row', gap: 12 },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E6F9F6',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  photoButtonText: { fontSize: 14, fontWeight: '500', color: '#25C1AC' },
  photoPreview: { marginTop: 12 },
  photoItem: { marginRight: 8, position: 'relative' },
  photoThumb: { width: 80, height: 80, borderRadius: 10 },
  removePhoto: { position: 'absolute', top: -6, right: -6 },
  offlineBanner: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
  },
  offlineBannerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  offlineBannerText: { flex: 1 },
  offlineBannerTitle: { fontSize: 14, fontWeight: '700' },
  offlineBannerSub: { fontSize: 13, color: '#777', marginTop: 2 },
  offlineBannerError: { fontSize: 12, color: '#c62828', marginTop: 2 },
  offlineBannerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    justifyContent: 'flex-end',
  },
  retryButton: {
    backgroundColor: '#25C1AC',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  dismissButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  dismissButtonText: { color: '#888', fontSize: 13, fontWeight: '500' },
  completeButton: {
    backgroundColor: '#25C1AC',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  completeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
