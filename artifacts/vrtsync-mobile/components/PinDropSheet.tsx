import React, { useState, useCallback, useEffect } from 'react';
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
import { generateAutoLabel, generateZoneLabel } from '@/lib/mcAutoLabel';
import type { ControllerRow } from './ControllerPicker';
import Toast from '@/components/Toast';

// ─── Asset type lists ──────────────────────────────────────────────────────

const ASSET_TYPES_GENERAL = [
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

type GeneralAssetKey = (typeof ASSET_TYPES_GENERAL)[number]['key'];

const ASSET_PRETTY: Record<string, string> = {
  controller: 'Controller',
  zone: 'Zone',
  tree: 'Tree',
  backflow: 'Backflow',
  pet_station: 'Pet Station',
  master_valve: 'Master Valve',
  flow_meter: 'Flow Meter',
  quick_connect: 'Quick Connect',
  isolation_valve: 'Isolation Valve',
  landscape_bed: 'Landscape Bed',
  bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area',
  snow_area: 'Snow Area',
  pump: 'Pump',
};

// ─── Props ─────────────────────────────────────────────────────────────────

export type PinDropSheetProps = {
  visible: boolean;
  onClose: () => void;
  communityId: string;
  latitude: number;
  longitude: number;
  // MC6 Map Creator props — when assetType is provided, enables Map Creator mode
  assetType?: string;
  assetColor?: string;
  existingLabels?: string[];
  parentController?: ControllerRow | null;
  existingZoneNumbers?: number[];
  onSave?: (assetId: string, label: string) => void;
  // MC7 general offline props
  onPinCreated?: (assetId: string | null, wasQueued: boolean) => void;
  // Re-shoot pre-fill
  initialLabel?: string;
  initialDescription?: string;
  // When set, fetches and shows existing attachments (edit mode)
  existingAssetId?: string;
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function PinDropSheet({
  visible,
  onClose,
  communityId,
  latitude,
  longitude,
  assetType: fixedAssetType,
  assetColor,
  existingLabels = [],
  parentController,
  existingZoneNumbers = [],
  onSave,
  onPinCreated,
  initialLabel,
  initialDescription,
  existingAssetId,
}: PinDropSheetProps) {
  const insets = useSafeAreaInsets();
  const { isOnline } = useOffline();
  const { pendingEntries, refreshList } = usePinQueue();
  const queryClient = useQueryClient();

  // MC6 Map Creator mode: assetType is fixed from outside
  const isMapCreatorMode = !!fixedAssetType;
  const isZone = isMapCreatorMode && fixedAssetType === 'zone' && !!parentController;

  // ─── MC6: auto-label computation ──────────────────────────────────────────
  const computedAutoLabel = React.useMemo(() => {
    if (!isMapCreatorMode) return '';
    if (isZone && parentController) {
      return generateZoneLabel({ parentControllerKey: parentController.controllerKey, existingZoneNumbers }).label;
    }
    return generateAutoLabel({ assetType: fixedAssetType!, existingLabels });
  }, [isMapCreatorMode, isZone, fixedAssetType, existingLabels, parentController, existingZoneNumbers]);

  const computedZoneNumber = React.useMemo(() => {
    if (!isZone || !parentController) return null;
    return generateZoneLabel({ parentControllerKey: parentController.controllerKey, existingZoneNumbers }).zoneNumber;
  }, [isZone, parentController, existingZoneNumbers]);

  // ─── Form state ───────────────────────────────────────────────────────────
  const [label, setLabel] = useState('');
  const [generalAssetType, setGeneralAssetType] = useState<GeneralAssetKey>('tree');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error'; key: number }>({
    visible: false, message: '', type: 'success', key: 0,
  });

  // Reset form when sheet opens
  useEffect(() => {
    if (visible) {
      setLabel(isMapCreatorMode ? (initialLabel ?? computedAutoLabel) : (initialLabel ?? ''));
      setDescription(initialDescription ?? '');
      setPhotoUri(null);
      setExistingPhotoUrl(null);
      setIsSaving(false);
      setError(null);
    }
  }, [visible, computedAutoLabel, isMapCreatorMode, initialLabel, initialDescription]);

  // Fetch existing attachments when editing an existing asset
  useEffect(() => {
    if (!visible || !existingAssetId) return;
    let cancelled = false;
    const apiBase = getApiUrl();
    apiRequest('GET', `/api/assets/${existingAssetId}/attachments`)
      .then((res) => res.json())
      .then((data: Array<{ url: string }>) => {
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          const rawUrl = data[0].url;
          const absUrl = rawUrl.startsWith('/') ? `${apiBase}${rawUrl}` : rawUrl;
          setExistingPhotoUrl(absUrl);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, existingAssetId]);

  const pendingCount = pendingEntries.filter(
    (e: { communityId: string; state: string }) =>
      e.communityId === communityId && (e.state === 'queued' || e.state === 'failed'),
  ).length;

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast((prev) => ({ visible: true, message, type, key: prev.key + 1 }));
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000);
  }, []);

  const resetForm = useCallback(() => {
    setLabel('');
    setGeneralAssetType('tree');
    setDescription('');
    setPhotoUri(null);
    setExistingPhotoUrl(null);
    setIsSaving(false);
    setError(null);
  }, []);

  // ─── Photo handlers (shared by both modes) ────────────────────────────────
  const handlePickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showToast('Camera access is required to take photos.', 'error');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: false });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }, [showToast]);

  const handlePickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showToast('Photo library access is required to select photos.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }, [showToast]);

  // ─── Save: Map Creator mode (MC6) ─────────────────────────────────────────
  const handleSaveMapCreator = async () => {
    if (!label.trim()) { setError('Label is required'); return; }
    setIsSaving(true);
    setError(null);

    try {
      const properties: Record<string, string> = { gps_accuracy: 'map_placed' };
      if (description.trim()) properties.description = description.trim();
      if (isZone && parentController) {
        properties.controllerFeatureRef = parentController.featureRef ?? '';
        properties.controllerLabel = parentController.label;
        properties.controllerKey = parentController.controllerKey;
        properties.controllerColor = parentController.controllerColor;
        if (computedZoneNumber !== null) properties.zoneNumber = String(computedZoneNumber);
      }

      const body: Record<string, unknown> = {
        communityId,
        assetType: fixedAssetType,
        label: label.trim(),
        latitude,
        longitude,
        geometryType: 'point',
        featureRef: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        tags: [],
        properties,
      };

      const res = await apiRequest('POST', '/api/assets', body);
      const asset = await res.json();
      if (!asset?.id) throw new Error(asset?.error || 'Unexpected server response');

      if (photoUri) {
        try {
          const apiUrl = getApiUrl();
          const presignRes = await fetch(`${apiUrl}/api/objects/upload`, { method: 'POST', credentials: 'include' });
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
            await apiRequest('POST', `/api/assets/${asset.id}/attachments`, {
              uploadURL,
              idempotencyKey: `mc_photo_${asset.id}_${Date.now()}`,
            });
          }
        } catch {
          showToast('Pin saved, but photo failed to upload.', 'error');
        }
      }

      queryClient.invalidateQueries({ queryKey: [`/api/communities/${communityId}/assets`] });
      queryClient.invalidateQueries({ queryKey: [`/api/communities/${communityId}/controllers`] });

      onSave?.(asset.id, label.trim());
    } catch (e: any) {
      let msg = e.message || 'Failed to save pin';
      try {
        const match = msg.match(/^\d+:\s*(.*)/s);
        if (match) {
          const parsed = JSON.parse(match[1]);
          msg = parsed.code === 'DUPLICATE_FEATURE_REF'
            ? 'A pin with this ID already exists. Please try again.'
            : parsed.error || parsed.message || msg;
        }
      } catch {}
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Save: General offline mode (MC7) ─────────────────────────────────────
  const handleSaveGeneral = useCallback(async () => {
    if (!label.trim()) { showToast('Please enter a label for this pin.', 'error'); return; }

    setIsSaving(true);
    const idempotencyKey = crypto.randomUUID();
    const optimisticId = `pending-${idempotencyKey}`;
    const cacheKey = ['/api/communities', communityId, 'assets'];
    const isDirectPath = isOnline && pendingCount === 0;

    const optimisticEntry = {
      id: optimisticId, communityId, assetType: generalAssetType,
      label: label.trim(), latitude, longitude, isArchived: false, pending: true,
    };

    if (isDirectPath) {
      const previousCache = queryClient.getQueryData<any[]>(cacheKey) ?? [];
      queryClient.setQueryData(cacheKey, [...previousCache, optimisticEntry]);

      try {
        const res = await apiRequest('POST', '/api/assets', {
          communityId, assetType: generalAssetType, label: label.trim(),
          latitude, longitude, idempotencyKey,
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
            const presignRes = await fetch(`${apiUrl}/api/objects/upload`, { method: 'POST', credentials: 'include' });
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
                uploadURL, idempotencyKey: idempotencyKey + '_photo',
              });
            }
          } catch {}
        }

        const currentCache = queryClient.getQueryData<any[]>(cacheKey) ?? [];
        queryClient.setQueryData(cacheKey, [
          ...currentCache.filter((a) => a.id !== optimisticId),
          { id: serverAssetId, communityId, assetType: generalAssetType, label: label.trim(), latitude, longitude, isArchived: false, pending: false },
        ]);
        showToast('Pin saved successfully.');
        onPinCreated?.(serverAssetId, false);
        resetForm();
        onClose();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to save pin.', 'error');
      } finally {
        setIsSaving(false);
      }
    } else {
      try {
        await pinCreationQueue.enqueue({
          communityId, assetType: generalAssetType, label: label.trim(),
          latitude, longitude, idempotencyKey, photoTempUri: photoUri ?? undefined,
        });
        const existing = queryClient.getQueryData<any[]>(cacheKey) ?? [];
        queryClient.setQueryData(cacheKey, [...existing, optimisticEntry]);
        refreshList();
        showToast(`Pin saved offline — will sync when connected (${pendingCount + 1} pending)`);
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
    label, generalAssetType, photoUri, communityId, latitude, longitude,
    isOnline, pendingCount, queryClient, refreshList, showToast, onPinCreated, onClose, resetForm,
  ]);

  const handleSave = isMapCreatorMode ? handleSaveMapCreator : handleSaveGeneral;

  // ─── Display values ────────────────────────────────────────────────────────
  const displayColor = isZone && parentController ? parentController.controllerColor : (assetColor ?? '#25C1AC');
  const prettyType = ASSET_PRETTY[fixedAssetType ?? ''] ?? (fixedAssetType ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // ─── Render ────────────────────────────────────────────────────────────────

  if (isMapCreatorMode) {
    return (
      <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={[styles.typePill, { backgroundColor: displayColor }]}>
              <Text style={styles.typePillText}>{prettyType}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {isZone && parentController && (
              <View style={[styles.parentChip, { borderColor: parentController.controllerColor }]}>
                <View style={[styles.parentCircle, { backgroundColor: parentController.controllerColor }]}>
                  <Text style={styles.parentKey}>{parentController.controllerKey}</Text>
                </View>
                <Text style={styles.parentLabel} numberOfLines={1}>
                  Controller {parentController.controllerKey} — {parentController.label}
                </Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color="#e74c3c" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Label</Text>
              <TextInput
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder={computedAutoLabel}
                placeholderTextColor="#aaa"
                maxLength={80}
                returnKeyType="done"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="Add any field notes…"
                placeholderTextColor="#aaa"
                multiline
                numberOfLines={3}
                maxLength={500}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Photo (optional)</Text>
              {(photoUri || existingPhotoUrl) ? (
                <View style={styles.photoPreviewRow}>
                  <Image source={{ uri: photoUri ?? existingPhotoUrl! }} style={styles.photoPreview} />
                  {photoUri ? (
                    <TouchableOpacity style={styles.removePhotoBtn} onPress={() => setPhotoUri(null)} activeOpacity={0.7}>
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                      <Text style={styles.removePhotoBtnText}>Remove</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.removePhotoBtn} onPress={handlePickFromLibrary} activeOpacity={0.7}>
                      <Ionicons name="camera-outline" size={18} color="#25C1AC" />
                      <Text style={[styles.removePhotoBtnText, { color: '#25C1AC' }]}>Replace</Text>
                    </TouchableOpacity>
                  )}
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
            </View>

            <View style={styles.coordRow}>
              <Ionicons name="location-outline" size={14} color="#9ca3af" />
              <Text style={styles.coordText}>
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSaving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: displayColor }, (!label.trim() || isSaving) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!label.trim() || isSaving}
              activeOpacity={0.85}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveText}>Save Pin</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} toastKey={toast.key} />
      </>
    );
  }

  // General offline mode (MC7)
  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.overlayGeneral}>
          <TouchableOpacity style={styles.backdropAbsolute} activeOpacity={1} onPress={onClose} />
          <View style={[styles.sheetGeneral, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handleGeneral} />

            <View style={styles.headerRow}>
              <Text style={styles.titleGeneral}>Drop a Pin</Text>
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

            <ScrollView style={styles.bodyGeneral} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabelGeneral}>Label *</Text>
              <TextInput
                style={styles.textInput}
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Oak Tree near entrance"
                placeholderTextColor="#9ca3af"
                autoFocus
                returnKeyType="done"
              />

              <Text style={styles.fieldLabelGeneral}>Asset Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeScrollContent}>
                {ASSET_TYPES_GENERAL.map((at) => (
                  <TouchableOpacity
                    key={at.key}
                    style={[styles.typeChip, generalAssetType === at.key && styles.typeChipActive]}
                    onPress={() => setGeneralAssetType(at.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.typeChipText, generalAssetType === at.key && styles.typeChipTextActive]}>
                      {at.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabelGeneral}>Photo (optional)</Text>
              {(photoUri || existingPhotoUrl) ? (
                <View style={styles.photoPreviewRow}>
                  <Image source={{ uri: photoUri ?? existingPhotoUrl! }} style={styles.photoPreview} />
                  {photoUri ? (
                    <TouchableOpacity style={styles.removePhotoBtn} onPress={() => setPhotoUri(null)} activeOpacity={0.7}>
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                      <Text style={styles.removePhotoBtnText}>Remove</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.removePhotoBtn} onPress={handlePickFromLibrary} activeOpacity={0.7}>
                      <Ionicons name="camera-outline" size={18} color="#25C1AC" />
                      <Text style={[styles.removePhotoBtnText, { color: '#25C1AC' }]}>Replace</Text>
                    </TouchableOpacity>
                  )}
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

              <View style={styles.coordRowGeneral}>
                <Ionicons name="location-outline" size={13} color="#9ca3af" />
                <Text style={styles.coordTextGeneral}>
                  {latitude.toFixed(6)}, {longitude.toFixed(6)}
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.saveBtnGeneral, isSaving && styles.saveBtnGeneralDisabled]}
              onPress={handleSaveGeneral}
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
                  <Text style={styles.saveBtnGeneralText}>
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

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Map Creator (MC6) mode — bottom sheet anchored to bottom
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
    gap: 10,
  },
  typePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    flex: 1,
  },
  typePillText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
  },
  closeBtn: {
    padding: 4,
  },
  parentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
    marginBottom: 12,
    backgroundColor: '#f9fafb',
  },
  parentCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  parentKey: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  parentLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#e74c3c',
    lineHeight: 18,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0C1D31',
    backgroundColor: '#fafafa',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  coordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  coordText: {
    fontSize: 12,
    color: '#9ca3af',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  // General offline mode (MC7) styles
  overlayGeneral: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropAbsolute: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetGeneral: {
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
  handleGeneral: {
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
  titleGeneral: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
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
  bodyGeneral: {
    flexShrink: 1,
  },
  fieldLabelGeneral: {
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
  coordRowGeneral: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 16,
    marginBottom: 4,
  },
  coordTextGeneral: {
    fontSize: 11,
    color: '#9ca3af',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  saveBtnGeneral: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  saveBtnGeneralDisabled: {
    backgroundColor: '#9ca3af',
  },
  saveBtnGeneralText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
