import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Image, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
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
  const { isOnline, addPendingCompletion } = useOffline();
  const insets = useSafeAreaInsets();

  const [notes, setNotes] = useState('');
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
    setCompleting(true);

    if (!isOnline) {
      await addPendingCompletion({
        id: Crypto.randomUUID(),
        taskId: task.id,
        version: task.version,
        notes: notes.trim() || undefined,
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
      const res = await apiRequest('POST', `/api/tasks/${task.id}/complete`, {
        version: task.version,
        notes: notes.trim() || undefined,
      });
      const { task: updatedTask, completion } = await res.json();

      for (const photoUri of photos) {
        try {
          const file = new ExpoFile(photoUri);
          const uploadURL = await uploadFileToStorage(file);

          await apiRequest('POST', `/api/tasks/${task.id}/attachments`, {
            taskCompletionId: completion.id,
            uploadURL,
          });
        } catch (uploadError) {
          console.error('Photo upload failed:', uploadError);
        }
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
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: task.title,
          headerRight: () =>
            task.status !== 'completed' ? (
              <TouchableOpacity onPress={() => setShowCompleteForm(true)}>
                <SymbolView name="checkmark.circle" size={24} tintColor="#1a73e8" />
              </TouchableOpacity>
            ) : null,
        }}
      />

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
            <SymbolView name="mappin" size={16} tintColor="#666" />
            <Text style={styles.detailText}>{task.address}</Text>
          </View>
        ) : null}
        {task.dueDate ? (
          <View style={styles.detailRow}>
            <SymbolView name="calendar" size={16} tintColor="#666" />
            <Text style={styles.detailText}>Due: {new Date(task.dueDate).toLocaleDateString()}</Text>
          </View>
        ) : null}
        <View style={styles.detailRow}>
          <SymbolView name="number" size={16} tintColor="#666" />
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
              {c.notes ? <Text style={styles.completionNotes}>{c.notes}</Text> : null}
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

      {showCompleteForm && task.status !== 'completed' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Complete Task</Text>

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

          <View style={styles.photoSection}>
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
                <SymbolView name="camera" size={20} tintColor="#1a73e8" />
                <Text style={styles.photoButtonText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoButton} onPress={pickPhoto}>
                <SymbolView name="photo" size={20} tintColor="#1a73e8" />
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
                      <SymbolView name="xmark.circle.fill" size={20} tintColor="#f44336" />
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

      {!showCompleteForm && task.status !== 'completed' && (
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
  title: { fontSize: 22, fontWeight: '700', color: '#222' },
  description: { fontSize: 15, color: '#555', marginTop: 8, lineHeight: 22 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  detailText: { fontSize: 14, color: '#555' },
  completionItem: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
    marginTop: 8,
  },
  completionDate: { fontSize: 12, color: '#999', marginBottom: 4 },
  completionNotes: { fontSize: 14, color: '#555' },
  attachmentRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  attachmentThumb: { width: 60, height: 60, borderRadius: 8 },
  notesInput: {
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#333',
    minHeight: 100,
    marginBottom: 12,
  },
  photoSection: { marginBottom: 12 },
  photoButtons: { flexDirection: 'row', gap: 12 },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e8f0fe',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  photoButtonText: { fontSize: 14, fontWeight: '500', color: '#1a73e8' },
  photoPreview: { marginTop: 12 },
  photoItem: { marginRight: 8, position: 'relative' },
  photoThumb: { width: 80, height: 80, borderRadius: 10 },
  removePhoto: { position: 'absolute', top: -6, right: -6 },
  completeButton: {
    backgroundColor: '#4caf50',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  completeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
