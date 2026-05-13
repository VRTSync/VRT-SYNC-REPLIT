import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { useOffline } from '@/client/contexts/OfflineContext';
import { pinCreationQueue } from '@/lib/pinCreationQueue';
import { usePinQueue } from '@/client/contexts/PinQueueContext';
import Toast from '@/components/Toast';

const ASSET_TYPES = [
  { key: 'tree', label: 'Tree' },
  { key: 'landscape_bed', label: 'Landscape Bed' },
  { key: 'controller', label: 'Irrigation Controller' },
  { key: 'backflow', label: 'Backflow' },
  { key: 'zone', label: 'Zone' },
  { key: 'pet_station', label: 'Pet Station' },
  { key: 'master_valve', label: 'Master Valve' },
  { key: 'flow_meter', label: 'Flow Meter' },
  { key: 'pump', label: 'Pump' },
  { key: 'quick_connect', label: 'Quick Connect' },
  { key: 'isolation_valve', label: 'Isolation Valve' },
] as const;

type AssetTypeKey = (typeof ASSET_TYPES)[number]['key'];

export type PinDropSheetProps = {
  visible: boolean;
  onClose: () => void;
  communityId: string;
  latitude: number;
  longitude: number;
  onPinCreated?: (assetId: string | null, wasQueued: boolean) => void;
};

export default function PinDropSheet({
  visible,
  onClose,
  communityId,
  latitude,
  longitude,
  onPinCreated,
}: PinDropSheetProps) {
  const insets = useSafeAreaInsets();
  const { isOnline } = useOffline();
  const { pendingEntries, refreshList } = usePinQueue();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState('');
  const [assetType, setAssetType] = useState<AssetTypeKey>('tree');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error'; key: number }>({
    visible: false,
    message: '',
    type: 'success',
    key: 0,
  });

  const pendingCount = pendingEntries.filter(
    (e: { communityId: string; state: string }) => e.communityId === communityId && (e.state === 'queued' || e.state === 'failed'),
  ).length;

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast((prev) => ({ visible: true, message, type, key: prev.key + 1 }));
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000);
  }, []);

  const handlePickPhoto = useCallback(async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }, []);

  const handlePickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }, []);

  const resetForm = useCallback(() => {
    setLabel('');
    setAssetType('tree');
    setPhotoUri(null);
    setIsSaving(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!label.trim()) {
      showToast('Please enter a label for this pin.', 'error');
      return;
    }

    setIsSaving(true);

    const idempotencyKey = crypto.randomUUID();
    const optimisticId = `pending-${idempotencyKey}`;
    const cacheKey = ['/api/communities', communityId, 'assets'];
    const isDirectPath = isOnline && pendingCount === 0;

    const optimisticEntry = {
      id: optimisticId,
      communityId,
      assetType,
      label: label.trim(),
      latitude,
      longitude,
      isArchived: false,
      pending: true,
    };

    if (isDirectPath) {
      const previousCache = queryClient.getQueryData<any[]>(cacheKey) ?? [];
      queryClient.setQueryData(cacheKey, [...previousCache, optimisticEntry]);

      try {
        const res = await apiRequest('POST', '/api/assets', {
          communityId,
          assetType,
          label: label.trim(),
          latitude,
          longitude,
          idempotencyKey,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          queryClient.setQueryData(cacheKey, previousCache);
          throw new Error(`Failed to create pin: ${res.status} ${body}`);
        }

        const asset = await res.json();
        const serverAssetId: string = asset.id;

        if (photoUri) {
          try {
            const apiUrl = getApiUrl();
            const presignRes = await fetch(`${apiUrl}/api/objects/upload`, {
              method: 'POST',
              credentials: 'include',
            });
            if (presignRes.ok) {
              const { uploadURL } = await presignRes.json();
              if (Platform.OS === 'web') {
                const blob = await fetch(photoUri).then((r) => r.blob());
                await fetch(uploadURL, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
              } else {
                await FileSystem.uploadAsync(uploadURL, photoUri, {
                  httpMethod: 'PUT',
                  uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
                  headers: { 'Content-Type': 'image/jpeg' },
                });
              }
              await apiRequest('POST', `/api/assets/${serverAssetId}/attachments`, {
                uploadURL,
                idempotencyKey: idempotencyKey + '_photo',
              });
            }
          } catch {
          }
        }

        const currentCache = queryClient.getQueryData<any[]>(cacheKey) ?? [];
        queryClient.setQueryData(cacheKey, [
          ...currentCache.filter((a) => a.id !== optimisticId),
          {
            id: serverAssetId,
            communityId,
            assetType,
            label: label.trim(),
            latitude,
            longitude,
            isArchived: false,
            pending: false,
          },
        ]);

        showToast('Pin saved successfully.');
        onPinCreated?.(serverAssetId, false);
        resetForm();
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to save pin.';
        showToast(msg, 'error');
      } finally {
        setIsSaving(false);
      }
    } else {
      try {
        await pinCreationQueue.enqueue({
          communityId,
          assetType,
          label: label.trim(),
          latitude,
          longitude,
          idempotencyKey,
          photoTempUri: photoUri ?? undefined,
        });

        const existing = queryClient.getQueryData<any[]>(cacheKey) ?? [];
        queryClient.setQueryData(cacheKey, [...existing, optimisticEntry]);

        refreshList();

        const newCount = pendingCount + 1;
        showToast(`Pin saved offline — will sync when connected (${newCount} pending)`);
        onPinCreated?.(null, true);
        resetForm();
        onClose();
      } catch {
        showToast('Failed to queue pin offline.', 'error');
      } finally {
        setIsSaving(false);
      }
    }
  }, [
    label,
    assetType,
    photoUri,
    communityId,
    latitude,
    longitude,
    isOnline,
    pendingCount,
    queryClient,
    refreshList,
    showToast,
    onPinCreated,
    onClose,
    resetForm,
  ]);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />

            <View style={styles.headerRow}>
              <Text style={styles.title}>Drop a Pin</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {!isOnline && (
              <View style={styles.offlineBanner}>
                <Ionicons name="cloud-offline-outline" size={14} color="#92400e" />
                <Text style={styles.offlineBannerText}>
                  You're offline — pin will sync automatically when connected.
                </Text>
              </View>
            )}

            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Label *</Text>
              <TextInput
                style={styles.textInput}
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Oak Tree near entrance"
                placeholderTextColor="#9ca3af"
                autoFocus
                returnKeyType="done"
              />

              <Text style={styles.fieldLabel}>Asset Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeScrollContent}>
                {ASSET_TYPES.map((at) => (
                  <TouchableOpacity
                    key={at.key}
                    style={[styles.typeChip, assetType === at.key && styles.typeChipActive]}
                    onPress={() => setAssetType(at.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.typeChipText, assetType === at.key && styles.typeChipTextActive]}>
                      {at.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Photo (optional)</Text>
              {photoUri ? (
                <View style={styles.photoPreviewRow}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                  <TouchableOpacity
                    style={styles.removePhotoBtn}
                    onPress={() => setPhotoUri(null)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    <Text style={styles.removePhotoBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.photoButtons}>
                  {Platform.OS !== 'web' && (
                    <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto} activeOpacity={0.7}>
                      <Ionicons name="camera-outline" size={18} color="#25C1AC" />
                      <Text style={styles.photoBtnText}>Camera</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.photoBtn} onPress={handlePickFromLibrary} activeOpacity={0.7}>
                    <Ionicons name="images-outline" size={18} color="#25C1AC" />
                    <Text style={styles.photoBtnText}>Library</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.coordRow}>
                <Ionicons name="location-outline" size={13} color="#9ca3af" />
                <Text style={styles.coordText}>
                  {latitude.toFixed(6)}, {longitude.toFixed(6)}
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={isSaving}
              activeOpacity={0.8}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name={isOnline && pendingCount === 0 ? 'checkmark-circle-outline' : 'cloud-upload-outline'}
                    size={18}
                    color="#fff"
                  />
                  <Text style={styles.saveBtnText}>
                    {isOnline && pendingCount === 0 ? 'Save Pin' : 'Save Offline'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Toast visible={toast.visible} message={toast.message} type={toast.type} toastKey={toast.key} />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingTop: 10,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    alignSelf: 'center',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  closeBtn: {
    padding: 4,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  offlineBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#92400e',
    lineHeight: 16,
  },
  body: {
    flexShrink: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 14,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0C1D31',
    backgroundColor: '#f9fafb',
  },
  typeScroll: {
    marginBottom: 4,
  },
  typeScrollContent: {
    gap: 8,
    paddingVertical: 2,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  typeChipActive: {
    borderColor: '#25C1AC',
    backgroundColor: '#f0fdfb',
  },
  typeChipText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  typeChipTextActive: {
    color: '#25C1AC',
    fontWeight: '700',
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#25C1AC',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#f0fdfb',
  },
  photoBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#25C1AC',
  },
  photoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  photoPreview: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#f0fdfb',
  },
  removePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  removePhotoBtnText: {
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '600',
  },
  coordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 16,
    marginBottom: 4,
  },
  coordText: {
    fontSize: 11,
    color: '#9ca3af',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  saveBtnDisabled: {
    backgroundColor: '#9ca3af',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
