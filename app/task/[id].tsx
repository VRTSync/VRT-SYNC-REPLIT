import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Image, Modal, FlatList, Dimensions, Platform, Linking,
} from 'react-native';
import Toast from '@/components/Toast';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import StatusBarFill from '@/components/StatusBarFill';
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
  status: 'pending' | 'in_progress' | 'completed' | 'submitted' | 'acknowledged';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  createdBy: string;
  dueDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  version: number;
  origin: string | null;
  category: string | null;
  acknowledgedAt: string | null;
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

type TaskLinkData = {
  id: string;
  taskId: string;
  linkType: 'asset' | 'pin';
  assetId: string | null;
  latitude: number | null;
  longitude: number | null;
  asset?: {
    id: string;
    assetType: string;
    label: string;
    featureRef: string | null;
    latitude: number | null;
    longitude: number | null;
  };
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
  pet_station: 'Pet Station', landscape_bed: 'Landscape Bed',
  bluegrass_area: 'Bluegrass Area', native_area: 'Native Area', snow_area: 'Snow Area',
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
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
};

function getTodayDenver(): Date {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  return new Date(todayStr + 'T00:00:00');
}

function toDateOnly(s: string): Date {
  const d = s.includes('T') ? s.split('T')[0] : s;
  return new Date(d + 'T00:00:00');
}

function isInWindow(task: Task): 'before' | 'in' | 'after' | null {
  if (!task.windowStart || !task.windowEnd) return null;
  const today = getTodayDenver();
  const start = toDateOnly(task.windowStart);
  const end = toDateOnly(task.windowEnd);
  if (today < start) return 'before';
  if (today > end) return 'after';
  return 'in';
}

function LifecycleTimeline({ task, completions }: { task: Task; completions: Completion[] }) {
  const isHoa = task.origin === 'HOA' || task.origin === 'hoa_request';
  const completion = completions && completions.length > 0 ? completions[0] : null;

  type Step = { label: string; ts: string | null; done: boolean };
  const steps: Step[] = [];

  function fmtTs(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  if (isHoa) {
    steps.push({ label: 'Submitted', ts: fmtTs(task.createdAt), done: true });
    steps.push({ label: 'Acknowledged', ts: fmtTs(task.acknowledgedAt), done: !!task.acknowledgedAt });
    steps.push({ label: 'In Progress', ts: null, done: task.status === 'in_progress' || task.status === 'completed' });
    steps.push({ label: 'Completed', ts: fmtTs(completion?.completedAt), done: task.status === 'completed' });
  } else {
    steps.push({ label: 'Submitted', ts: fmtTs(task.createdAt), done: true });
    steps.push({ label: 'Acknowledged', ts: fmtTs(task.acknowledgedAt), done: !!task.acknowledgedAt || task.status === 'in_progress' || task.status === 'completed' });
    steps.push({ label: 'In Progress', ts: null, done: task.status === 'in_progress' || task.status === 'completed' });
    steps.push({ label: 'Completed', ts: fmtTs(completion?.completedAt), done: task.status === 'completed' });
  }

  return (
    <View style={tlStyles.container}>
      <Text style={tlStyles.heading}>Lifecycle</Text>
      <View style={tlStyles.timeline}>
        {steps.map((step, idx) => (
          <View key={idx} style={tlStyles.step}>
            <View style={tlStyles.dotCol}>
              <View style={[tlStyles.dot, step.done ? tlStyles.dotDone : tlStyles.dotPending]} />
              {idx < steps.length - 1 && <View style={tlStyles.line} />}
            </View>
            <View style={tlStyles.stepContent}>
              <Text style={[tlStyles.stepLabel, !step.done && tlStyles.stepLabelPending]}>
                {step.label}
              </Text>
              {step.ts ? (
                <Text style={tlStyles.stepTs}>{step.ts}</Text>
              ) : step.done ? null : (
                <Text style={tlStyles.stepTsPending}>Pending</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const tlStyles = StyleSheet.create({
  container: {
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
  heading: { fontSize: 16, fontWeight: '700', color: '#0C1D31', marginBottom: 14 },
  timeline: { paddingLeft: 0 },
  step: { flexDirection: 'row', gap: 12 },
  dotCol: { alignItems: 'center', width: 16 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, flexShrink: 0 },
  dotDone: { backgroundColor: '#25C1AC', borderColor: '#25C1AC' },
  dotPending: { backgroundColor: '#fff', borderColor: '#d1d5db' },
  line: { flex: 1, width: 2, backgroundColor: '#e5e7eb', marginTop: 2, marginBottom: 2, minHeight: 16 },
  stepContent: { flex: 1, paddingBottom: 14 },
  stepLabel: { fontSize: 13, fontWeight: '600', color: '#0C1D31' },
  stepLabelPending: { color: '#9ca3af' },
  stepTs: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  stepTsPending: { fontSize: 11, color: '#d1d5db', marginTop: 2, fontStyle: 'italic' },
});

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isHoaAdmin = user?.role === 'hoa_admin';
  const isHoaMember = user?.role === 'hoa_member';
  const isHoaUser = isHoaAdmin || isHoaMember;
  const isContractor = user?.role === 'contractor';
  const { activeCommunity } = useCommunity();
  const { isOnline, addPendingCompletion, getCompletionForTask, retryCompletion, dismissCompletion, syncPendingCompletions, pendingCompletions } = useOffline();

  const [notes, setNotes] = useState('');
  const [signOffName, setSignOffName] = useState('');
  const [timeSpent, setTimeSpent] = useState('');
  const [materialsUsed, setMaterialsUsed] = useState('');
  const [followUpNeeded, setFollowUpNeeded] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [photoViewerImages, setPhotoViewerImages] = useState<{ id: string; url: string }[]>([]);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const [acknowledging, setAcknowledging] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    };
  }, []);

  type TaskDetailBundle = { task: Task; completions: Completion[]; taskAttachments: { id: string; url: string; fileRef: string; createdAt: string }[]; taskLink: TaskLinkData | null };

  const { data: bundle, isLoading, isError: isBundleError, error: bundleError, refetch: refetchBundle } = useQuery<TaskDetailBundle>({
    queryKey: [`/api/tasks/${id}/detail`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!id,
    staleTime: 0,
    retry: 1,
  });

  const task = bundle?.task ?? null;
  const completions: Completion[] = bundle?.completions ?? [];
  const taskAttachments: { id: string; url: string; fileRef: string; createdAt: string }[] = bundle?.taskAttachments ?? [];
  const taskLink: TaskLinkData | null = bundle?.taskLink ?? null;

  const isError = isBundleError;
  const anyError: Error | null = bundleError instanceof Error ? bundleError : null;

  const handleRetryAll = () => {
    if (isBundleError) refetchBundle();
  };

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
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${id}/detail`] });

      setToastMessage('Task marked complete');
      setToastVisible(true);
      navTimeoutRef.current = setTimeout(() => router.replace('/(tabs)/tasks'), 1500);
    } catch (e: any) {
      if (e.message?.includes('409')) {
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${id}/detail`] });
        Alert.alert(
          'Update Conflict',
          'This task was modified by someone else. The latest version has been loaded — please review and try again.',
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert('Error', e.message || 'Failed to complete task');
      }
    } finally {
      setCompleting(false);
    }
  };

  const isHoaRequest = task?.origin === 'HOA';

  const handleAcknowledge = async () => {
    if (!task) return;
    setAcknowledging(true);
    try {
      await apiRequest('PUT', `/api/tasks/${task.id}`, {
        status: 'acknowledged',
        version: task.version,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${id}/detail`] });
      setToastMessage('Request acknowledged');
      setToastVisible(true);
      toastTimeoutRef.current = setTimeout(() => setToastVisible(false), 2800);
    } catch (e: any) {
      if (e.message?.includes('409')) {
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${id}/detail`] });
        Alert.alert('Update Conflict', 'This task was modified. Please try again.');
      } else {
        Alert.alert('Error', e.message || 'Failed to acknowledge request');
      }
    } finally {
      setAcknowledging(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBackBtn}>
            <Ionicons name="arrow-back" size={22} color="#0C1D31" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Loading...</Text>
          <View style={styles.headerActionBtn} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      </View>
    );
  }

  if (!task && !isLoading) {
    const msg = anyError?.message ?? '';
    const errorMessage = !isError
      ? 'Task not found.'
      : msg.includes('403')
        ? 'You do not have access to this task.'
        : msg.includes('404')
          ? 'Task not found.'
          : 'Failed to load task. Please try again.';
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBackBtn}>
            <Ionicons name="arrow-back" size={22} color="#0C1D31" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Error</Text>
          <View style={styles.headerActionBtn} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#f44336" />
          <Text style={styles.errorText}>{errorMessage}</Text>
          {isError && (
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetryAll}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const pendingForTask = pendingCompletions.find(c => c.taskId === id && c.state !== 'synced');

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBackBtn}>
          <Ionicons name="arrow-back" size={22} color="#0C1D31" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{task.title}</Text>
        {isContractor && task.status === 'in_progress' && !pendingForTask ? (
          <TouchableOpacity onPress={() => setShowCompleteForm(true)} style={styles.headerActionBtn}>
            <Ionicons name="checkmark-circle-outline" size={24} color="#25C1AC" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerActionBtn} />
        )}
      </View>
      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={styles.content} bottomOffset={60}>

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

      {isBundleError && task && (
        <View style={styles.staleBanner}>
          <Ionicons name="cloud-offline-outline" size={15} color="#b45309" />
          <Text style={styles.staleBannerText}>Couldn't refresh — showing cached data.</Text>
          <TouchableOpacity onPress={() => refetchBundle()}>
            <Text style={styles.staleBannerRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {isHoaMember ? (
        /* ── HOA Member: simplified read-only view ── */
        <>
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
            {task.windowStart && task.windowEnd ? (
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={16} color="#666" />
                <Text style={styles.detailText}>
                  Window: {toDateOnly(task.windowStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {toDateOnly(task.windowEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </View>
            ) : null}
            {task.address ? (
              <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={16} color="#666" />
                <Text style={styles.detailText}>{task.address}</Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={16} color="#666" />
              <Text style={styles.detailText}>Created: {new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            </View>
          </View>

          <LifecycleTimeline task={task!} completions={completions} />
        </>
      ) : (
        /* ── All other roles: full view ── */
        <>
          {isHoaRequest && (
            <View style={styles.hoaBanner}>
              <View style={styles.hoaBannerTop}>
                <View style={styles.hoaBadge}>
                  <Ionicons name="home-outline" size={14} color="#fff" />
                  <Text style={styles.hoaBadgeText}>HOA REQUEST</Text>
                </View>
                <View style={[
                  styles.hoaStatusChip,
                  { backgroundColor: task.status === 'submitted' ? '#fff3e0' : '#e8f5e9' }
                ]}>
                  <Text style={[
                    styles.hoaStatusChipText,
                    { color: task.status === 'submitted' ? '#e65100' : '#2e7d32' }
                  ]}>
                    {task.status === 'submitted' ? 'New Request' : 'Acknowledged'}
                  </Text>
                </View>
              </View>
              {task.address && (
                <View style={styles.detailRow}>
                  <Ionicons name="location-outline" size={14} color="#666" />
                  <Text style={styles.detailText}>{task.address}</Text>
                </View>
              )}
            </View>
          )}

          {(task.address || (isHoaRequest && task.latitude != null && task.longitude != null)) && (
            <TouchableOpacity
              style={styles.viewOnMapButton}
              onPress={() => {
                if (isHoaRequest && task.latitude != null && task.longitude != null) {
                  router.push(`/request-map/${task.id}` as any);
                } else if (task.address) {
                  const addr = encodeURIComponent(task.address);
                  if (Platform.OS === 'ios') {
                    Linking.openURL(`maps://?q=${addr}`);
                  } else {
                    Linking.openURL(`https://maps.google.com/?q=${addr}`);
                  }
                }
              }}
            >
              <Ionicons name="map-outline" size={18} color="#fff" />
              <Text style={styles.viewOnMapButtonText}>View on Map</Text>
            </TouchableOpacity>
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
            {task.windowStart && task.windowEnd ? (
              <View style={styles.windowRow}>
                <Ionicons name="time-outline" size={16} color={
                  isInWindow(task) === 'after' ? '#c62828' :
                  isInWindow(task) === 'in' ? '#25C1AC' : '#1565c0'
                } />
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailText}>
                    Window: {toDateOnly(task.windowStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {toDateOnly(task.windowEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                  {isInWindow(task) === 'after' && task.status !== 'completed' ? (
                    <Text style={styles.windowWarning}>Window has passed</Text>
                  ) : isInWindow(task) === 'before' && task.status !== 'completed' ? (
                    <Text style={styles.windowUpcoming}>Not yet in window</Text>
                  ) : null}
                </View>
              </View>
            ) : null}
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
            {task.category ? (
              <View style={styles.detailRow}>
                <Ionicons name="pricetag-outline" size={16} color="#666" />
                <Text style={styles.detailText}>Category: {task.category}</Text>
              </View>
            ) : null}
            {(task.assignedToName || task.assignedTo) ? (
              <View style={styles.detailRow}>
                <Ionicons name="person-outline" size={16} color="#666" />
                <Text style={styles.detailText}>Contractor: {task.assignedToName || task.assignedTo}</Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={16} color="#666" />
              <Text style={styles.detailText}>Created: {new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            </View>
            {isHoaRequest && (
              <View style={styles.detailRow}>
                <Ionicons name="checkmark-done-outline" size={16} color="#666" />
                <Text style={styles.detailText}>
                  {task.acknowledgedAt
                    ? `Acknowledged: ${new Date(task.acknowledgedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : 'Not acknowledged yet'}
                </Text>
              </View>
            )}
          </View>

          {task.windowStart && task.windowEnd && isInWindow(task) !== 'in' && task.status !== 'completed' && (
            user?.role === 'admin' ? (
              <View style={styles.adminOverrideBanner}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#e65100" />
                <Text style={styles.adminOverrideText}>
                  Admin override: You can complete this task outside its execution window.
                </Text>
              </View>
            ) : (
              <View style={styles.windowBlockBanner}>
                <Ionicons name="lock-closed-outline" size={16} color="#c62828" />
                <Text style={styles.windowBlockText}>
                  {isInWindow(task) === 'before'
                    ? `This task cannot be completed until ${toDateOnly(task.windowStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`
                    : `This task's execution window ended on ${toDateOnly(task.windowEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`}
                </Text>
              </View>
            )
          )}
        </>
      )}

      {(isHoaAdmin || user?.role === 'property_manager') && <LifecycleTimeline task={task!} completions={completions} />}

      {!isHoaMember && taskLink && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {taskLink.linkType === 'asset' ? 'Linked Asset' : 'Linked Location'}
          </Text>
          {taskLink.linkType === 'asset' && taskLink.asset ? (
            <View>
              <View style={styles.linkedAssetHeader}>
                <View style={styles.linkedAssetTypeBadge}>
                  <Text style={styles.linkedAssetTypeBadgeText}>
                    {ASSET_TYPE_LABELS[taskLink.asset.assetType] || taskLink.asset.assetType}
                  </Text>
                </View>
                <Text style={styles.linkedAssetLabel}>{taskLink.asset.label}</Text>
              </View>
              {taskLink.asset.featureRef ? (
                <View style={styles.detailRow}>
                  <Ionicons name="bookmark-outline" size={16} color="#666" />
                  <Text style={styles.detailText}>Ref: {taskLink.asset.featureRef}</Text>
                </View>
              ) : null}
              {taskLink.asset.latitude != null && taskLink.asset.longitude != null ? (
                <View style={styles.detailRow}>
                  <Ionicons name="navigate-outline" size={16} color="#666" />
                  <Text style={styles.detailText}>
                    {taskLink.asset.latitude.toFixed(6)}, {taskLink.asset.longitude.toFixed(6)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.linkedAssetActions}>
                <TouchableOpacity
                  style={styles.linkedAssetBtn}
                  onPress={() => router.push(`/asset/${taskLink.asset!.id}` as any)}
                >
                  <Ionicons name="information-circle-outline" size={16} color="#25C1AC" />
                  <Text style={styles.linkedAssetBtnText}>Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkedAssetBtn}
                  onPress={() => router.push(`/asset/${taskLink.asset!.id}/history` as any)}
                >
                  <Ionicons name="time-outline" size={16} color="#0C1D31" />
                  <Text style={[styles.linkedAssetBtnText, { color: '#0C1D31' }]}>Work History</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : taskLink.linkType === 'pin' && taskLink.latitude != null && taskLink.longitude != null ? (
            <View style={styles.detailRow}>
              <Ionicons name="pin-outline" size={16} color="#666" />
              <Text style={styles.detailText}>
                {taskLink.latitude.toFixed(6)}, {taskLink.longitude.toFixed(6)}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {!isHoaMember && taskAttachments.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Request Photos</Text>
          <View style={styles.completionPhotosSection}>
            <View style={styles.completionDetailRow}>
              <Ionicons name="camera-outline" size={16} color="#25C1AC" />
              <Text style={styles.completionDetailLabel}>Photos ({taskAttachments.length})</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.completionPhotoScroll}>
              {taskAttachments.map((a, aIdx) => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => {
                    setPhotoViewerImages(taskAttachments.map(att => ({ id: att.id, url: `${getApiUrl()}${att.url}` })));
                    setPhotoViewerIndex(aIdx);
                    setPhotoViewerVisible(true);
                  }}
                >
                  <Image
                    source={{ uri: `${getApiUrl()}${a.url}` }}
                    style={styles.completionPhotoThumb}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {!isHoaMember && completions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Completion Details</Text>
          {completions.map((c, cIdx) => (
            <View key={c.id} style={[styles.completionItem, cIdx === 0 && { borderTopWidth: 0, marginTop: 0, paddingTop: 0 }]}>
              <View style={styles.completionHeader}>
                <View style={styles.completedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#fff" />
                  <Text style={styles.completedBadgeText}>Completed</Text>
                </View>
                <Text style={styles.completionDate}>
                  {new Date(c.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(c.completedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>

              <View style={styles.completionDetailRow}>
                <Ionicons name="person-outline" size={16} color="#25C1AC" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.completionDetailLabel}>Signed Off By</Text>
                  <Text style={styles.completionDetailValue}>{c.employeeSignOffName}</Text>
                </View>
              </View>

              {c.notes ? (
                <View style={styles.completionDetailRow}>
                  <Ionicons name="document-text-outline" size={16} color="#25C1AC" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.completionDetailLabel}>Notes</Text>
                    <Text style={styles.completionDetailValue}>{c.notes}</Text>
                  </View>
                </View>
              ) : null}

              {c.timeSpentMinutes ? (
                <View style={styles.completionDetailRow}>
                  <Ionicons name="timer-outline" size={16} color="#25C1AC" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.completionDetailLabel}>Time Spent</Text>
                    <Text style={styles.completionDetailValue}>
                      {c.timeSpentMinutes >= 60
                        ? `${Math.floor(c.timeSpentMinutes / 60)}h ${c.timeSpentMinutes % 60}m`
                        : `${c.timeSpentMinutes} min`}
                    </Text>
                  </View>
                </View>
              ) : null}

              {c.materialsUsed ? (
                <View style={styles.completionDetailRow}>
                  <Ionicons name="construct-outline" size={16} color="#25C1AC" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.completionDetailLabel}>Materials Used</Text>
                    <Text style={styles.completionDetailValue}>{c.materialsUsed}</Text>
                  </View>
                </View>
              ) : null}

              {c.followUpNeeded ? (
                <View style={styles.completionDetailRow}>
                  <Ionicons name="flag-outline" size={16} color="#e65100" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.completionDetailLabel}>Follow-Up Needed</Text>
                    <Text style={[styles.completionDetailValue, { color: '#e65100' }]}>{c.followUpNeeded}</Text>
                  </View>
                </View>
              ) : null}

              {c.attachments && c.attachments.length > 0 && (
                <View style={styles.completionPhotosSection}>
                  <View style={styles.completionDetailRow}>
                    <Ionicons name="camera-outline" size={16} color="#25C1AC" />
                    <Text style={styles.completionDetailLabel}>Photos ({c.attachments.length})</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.completionPhotoScroll}>
                    {c.attachments.map((a, aIdx) => (
                      <TouchableOpacity
                        key={a.id}
                        onPress={() => {
                          setPhotoViewerImages(c.attachments.map(att => ({ id: att.id, url: `${getApiUrl()}${att.url}` })));
                          setPhotoViewerIndex(aIdx);
                          setPhotoViewerVisible(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={{ uri: `${getApiUrl()}${a.url}` }}
                          style={styles.completionPhotoThumb}
                        />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <Modal
        visible={photoViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoViewerVisible(false)}
      >
        <View style={styles.photoViewerOverlay}>
          <TouchableOpacity
            style={styles.photoViewerClose}
            onPress={() => setPhotoViewerVisible(false)}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {photoViewerImages.length > 1 && (
            <Text style={styles.photoViewerCounter}>
              {photoViewerIndex + 1} / {photoViewerImages.length}
            </Text>
          )}
          <FlatList
            data={photoViewerImages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={photoViewerIndex}
            getItemLayout={(_, index) => ({
              length: Dimensions.get('window').width,
              offset: Dimensions.get('window').width * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get('window').width);
              setPhotoViewerIndex(idx);
            }}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.photoViewerSlide}>
                <Image
                  source={{ uri: item.url }}
                  style={styles.photoViewerImage}
                  resizeMode="contain"
                />
              </View>
            )}
          />
        </View>
      </Modal>

      {isContractor && !pendingForTask && task.status !== 'completed'
        && (task.status === 'pending' || task.status === 'acknowledged') && !showCompleteForm && (
        <TouchableOpacity
          style={styles.markInProgressButton}
          onPress={async () => {
            try {
              await apiRequest('PUT', `/api/tasks/${task!.id}`, { status: 'in_progress', version: task!.version });
              queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
              queryClient.invalidateQueries({ queryKey: [`/api/tasks/${id}/detail`] });
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to update task');
            }
          }}
        >
          <Ionicons name="play-circle-outline" size={20} color="#fff" />
          <Text style={styles.markInProgressButtonText}>Mark In Progress</Text>
        </TouchableOpacity>
      )}

      {isContractor && showCompleteForm && task.status === 'in_progress' && !pendingForTask && (
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

      {isContractor && !showCompleteForm && task.status === 'in_progress' && !pendingForTask && (() => {
        const windowStatus = isInWindow(task);
        const blocked = windowStatus !== null && windowStatus !== 'in' && user?.role !== 'admin';
        if (blocked) return null;
        return (
          <TouchableOpacity
            style={styles.completeButton}
            onPress={() => setShowCompleteForm(true)}
          >
            <Text style={styles.completeButtonText}>Complete This Task</Text>
          </TouchableOpacity>
        );
      })()}
      </KeyboardAwareScrollViewCompat>
      <Toast visible={toastVisible} message={toastMessage} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { padding: 16, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fffbeb', borderColor: '#fcd34d', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12,
  },
  staleBannerText: { flex: 1, fontSize: 13, color: '#92400e' },
  staleBannerRetry: { fontSize: 13, fontWeight: '600' as const, color: '#b45309' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 16 },
  errorText: { fontSize: 16, color: '#555', textAlign: 'center', lineHeight: 24 },
  retryBtn: { backgroundColor: '#25C1AC', borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' as const },
  backBtn: { backgroundColor: '#e8eaed', borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12 },
  backBtnText: { color: '#0C1D31', fontSize: 16, fontWeight: '600' as const },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
    backgroundColor: '#f5f7fa',
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e8eaed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  windowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  windowWarning: { fontSize: 12, color: '#c62828', marginTop: 2, fontWeight: '500' },
  windowUpcoming: { fontSize: 12, color: '#1565c0', marginTop: 2, fontWeight: '500' },
  adminOverrideBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff3e0',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ffcc80',
  },
  adminOverrideText: { fontSize: 13, color: '#e65100', flex: 1, fontWeight: '500' },
  windowBlockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffebee',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ef9a9a',
  },
  windowBlockText: { fontSize: 13, color: '#c62828', flex: 1, fontWeight: '500' },
  completionItem: {
    borderTopWidth: 1,
    borderTopColor: '#eef1f5',
    paddingTop: 16,
    marginTop: 12,
  },
  completionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#25C1AC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  completedBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#fff',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  completionDate: { fontSize: 12, color: '#999' },
  completionDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
    paddingLeft: 2,
  },
  completionDetailLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#999',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  completionDetailValue: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  completionPhotosSection: {
    marginTop: 4,
  },
  completionPhotoScroll: {
    marginTop: 8,
    marginLeft: 28,
  },
  completionPhotoThumb: {
    width: 100,
    height: 100,
    borderRadius: 10,
    marginRight: 10,
    backgroundColor: '#f0f0f0',
  },
  photoViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
  },
  photoViewerClose: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 20 : 50,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoViewerCounter: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 28 : 58,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const,
    zIndex: 10,
  },
  photoViewerSlide: {
    width: Dimensions.get('window').width,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  photoViewerImage: {
    width: Dimensions.get('window').width - 32,
    height: Dimensions.get('window').height * 0.7,
  },
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
  linkedAssetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  linkedAssetTypeBadge: {
    backgroundColor: '#E6F9F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  linkedAssetTypeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#25C1AC',
  },
  linkedAssetLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0C1D31',
    flex: 1,
  },
  linkedAssetActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  linkedAssetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f5f7fa',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  linkedAssetBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#25C1AC',
  },
  hoaBanner: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#7c4dff',
    shadowColor: '#7c4dff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  hoaBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  hoaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7c4dff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  hoaBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#fff',
    letterSpacing: 0.8,
  },
  hoaStatusChip: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  hoaStatusChipText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  hoaPriorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  hoaPriorityLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#888',
  },
  hoaPriorityValue: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  acknowledgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1565c0',
    borderRadius: 999,
    padding: 14,
    marginTop: 12,
  },
  acknowledgeButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  acknowledgeStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 8,
  },
  acknowledgeStatusText: {
    fontSize: 13,
    color: '#25C1AC',
    fontWeight: '600' as const,
    flex: 1,
  },
  viewOnMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  viewOnMapButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  markInProgressButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    borderRadius: 999,
    padding: 16,
    marginBottom: 12,
  },
  markInProgressButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
});
