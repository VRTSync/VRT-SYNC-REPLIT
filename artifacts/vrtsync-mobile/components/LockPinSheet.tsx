import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
import { generateAutoLabel, generateZoneLabel } from '@/lib/mcAutoLabel';
import type { Fix } from '@/hooks/useHighAccuracyLocation';
import type { ControllerRow } from '@/components/ControllerPicker';
import Toast from '@/components/Toast';

const LOCK_COLORS: Record<string, string> = {
  green: '#4CAF50',
  yellow: '#FFC107',
};

const ASSET_TYPE_PRETTY: Record<string, string> = {
  tree: 'Tree',
  pet_station: 'Pet Station',
  controller: 'Controller',
  backflow: 'Backflow',
  pump: 'Pump',
  master_valve: 'Master Valve',
  flow_meter: 'Flow Meter',
  quick_connect: 'Quick Connect',
  isolation_valve: 'Isolation Valve',
  zone: 'Zone',
};

export type LockPinSheetProps = {
  visible: boolean;
  fix: Fix;
  armedType: string;
  communityId: string;
  existingLabels: string[];
  parentController?: ControllerRow | null;
  existingZoneNumbers?: number[];
  onDismiss: () => void;
  onSaved: (asset: any) => void;
};

export default function LockPinSheet({
  visible,
  fix,
  armedType,
  communityId,
  existingLabels,
  parentController,
  existingZoneNumbers = [],
  onDismiss,
  onSaved,
}: LockPinSheetProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const isZone = armedType === 'zone' && !!parentController;

  const { autoLabel, zoneNumber } = useMemo(() => {
    if (isZone && parentController) {
      const result = generateZoneLabel({
        parentControllerKey: parentController.controllerKey,
        existingZoneNumbers,
      });
      return { autoLabel: result.label, zoneNumber: result.zoneNumber };
    }
    return {
      autoLabel: generateAutoLabel({ assetType: armedType, existingLabels }),
      zoneNumber: null,
    };
  }, [isZone, parentController, existingZoneNumbers, armedType, existingLabels]);

  const [label, setLabel] = useState(autoLabel);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error'; key: number }>({
    visible: false,
    message: '',
    type: 'success',
    key: 0,
  });

  useEffect(() => {
    if (visible) {
      setLabel(autoLabel);
      setPhotoUri(null);
      setInlineError(null);
      setIsSaving(false);
    }
  }, [visible, autoLabel]);

  const lockColor = fix.accuracy <= 5 ? LOCK_COLORS.green : LOCK_COLORS.yellow;
  const isYellowLock = fix.accuracy > 5;
  const prettyType = ASSET_TYPE_PRETTY[armedType] ?? armedType;

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

  const saveColor = isZone && parentController ? parentController.controllerColor : '#4CAF50';

  const handleSave = useCallback(async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return;

    setIsSaving(true);
    setInlineError(null);

    try {
      const properties: Record<string, string> = {};
      if (isZone && parentController) {
        properties.controllerFeatureRef = parentController.featureRef ?? '';
        properties.controllerLabel = parentController.label;
        properties.controllerKey = parentController.controllerKey;
        properties.controllerColor = parentController.controllerColor;
        if (zoneNumber !== null) properties.zoneNumber = String(zoneNumber);
      }

      const body: Record<string, unknown> = {
        communityId,
        assetType: armedType,
        label: trimmedLabel,
        latitude: fix.latitude,
        longitude: fix.longitude,
      };

      if (isZone) {
        body.featureRef = `mc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        body.tags = [];
        body.geometryType = 'point';
        body.properties = properties;
      }

      const res = await apiRequest('POST', '/api/assets', body);

      if (res.status === 409) {
        const body = await res.json().catch(() => ({ error: 'Duplicate pin reference' }));
        setInlineError(body.error ?? 'A pin with this reference already exists.');
        setIsSaving(false);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to save pin' }));
        showToast(body.error ?? 'Failed to save pin', 'error');
        setIsSaving(false);
        return;
      }

      const data = await res.json();
      const asset = data.asset ?? data;
      const assetId: string = asset.id;

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
                headers: { 'Content-Type': 'image/jpeg' },
              });
            }
            const idempotencyKey = `${assetId}_photo_${Date.now()}`;
            await apiRequest('POST', `/api/assets/${assetId}/attachments`, {
              uploadURL,
              idempotencyKey,
            });
          }
        } catch {
        }
      }

      queryClient.invalidateQueries({ queryKey: ['/api/map-layers', { communityId }] });
      if (armedType === 'controller' || armedType === 'zone') {
        queryClient.invalidateQueries({ queryKey: ['/api/communities', communityId, 'controllers'] });
      }

      onSaved(asset);
      showToast(`${trimmedLabel} saved!`);
    } catch {
      showToast('Network error — please try again', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [label, armedType, communityId, fix, photoUri, queryClient, onSaved, showToast, isZone, parentController, zoneNumber]);

  const canSave = label.trim().length > 0 && !isSaving;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onDismiss}
      >
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />

            <View style={styles.headerRow}>
              <Text style={styles.title}>Confirm Pin</Text>
              <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{prettyType}</Text>
            </View>

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

            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {isYellowLock && (
                <View style={styles.yellowWarning}>
                  <Ionicons name="warning-outline" size={14} color="#92400e" />
                  <Text style={styles.yellowWarningText}>
                    Accuracy {Math.round(fix.accuracy)}m — consider waiting for green lock
                  </Text>
                </View>
              )}

              <View style={styles.gpsFix}>
                <View style={[styles.lockPill, { backgroundColor: lockColor + '22' }]}>
                  <View style={[styles.lockDot, { backgroundColor: lockColor }]} />
                  <Text style={[styles.lockPillText, { color: lockColor }]}>
                    {isYellowLock ? 'Yellow Lock' : 'Green Lock'}
                  </Text>
                </View>
                <Text style={styles.gpsCoords}>
                  {fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)}
                </Text>
                <Text style={styles.gpsAccuracy}>
                  ±{Math.round(fix.accuracy)}m
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Label *</Text>
              <TextInput
                style={[styles.textInput, inlineError ? styles.textInputError : null]}
                value={label}
                onChangeText={(t) => {
                  setLabel(t.slice(0, 80));
                  setInlineError(null);
                }}
                placeholder="Label required"
                placeholderTextColor="#9ca3af"
                maxLength={80}
                returnKeyType="done"
              />
              <Text style={styles.charCount}>{label.length}/80</Text>

              {inlineError && (
                <View style={styles.inlineError}>
                  <Ionicons name="alert-circle-outline" size={14} color="#b91c1c" />
                  <Text style={styles.inlineErrorText}>{inlineError}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>Photo (optional)</Text>
              {photoUri ? (
                <View style={styles.photoPreviewRow}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                  <View style={styles.photoActions}>
                    <TouchableOpacity style={styles.photoActionBtn} onPress={Platform.OS !== 'web' ? handlePickPhoto : handlePickFromLibrary} activeOpacity={0.7}>
                      <Ionicons name="camera-outline" size={16} color="#25C1AC" />
                      <Text style={styles.photoActionBtnText}>Replace</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.photoActionBtn, styles.removeBtn]} onPress={() => setPhotoUri(null)} activeOpacity={0.7}>
                      <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
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
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss} activeOpacity={0.8}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: canSave ? saveColor : undefined }, !canSave && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.8}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="pin" size={16} color="#fff" />
                    <Text style={styles.saveBtnText}>Save Pin</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
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
    maxHeight: '88%',
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
  typePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#f0fdfb',
    borderWidth: 1,
    borderColor: '#25C1AC',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 12,
  },
  typePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#25C1AC',
  },
  body: {
    flexShrink: 1,
  },
  yellowWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  yellowWarningText: {
    flex: 1,
    fontSize: 12,
    color: '#92400e',
    lineHeight: 16,
  },
  gpsFix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  lockDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  lockPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  gpsCoords: {
    fontSize: 11,
    color: '#6b7280',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  gpsAccuracy: {
    fontSize: 11,
    color: '#9ca3af',
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
  textInputError: {
    borderColor: '#ef4444',
  },
  charCount: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 3,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 6,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 12,
    color: '#b91c1c',
    lineHeight: 16,
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
  photoActions: {
    gap: 8,
  },
  photoActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#25C1AC',
    backgroundColor: '#f0fdfb',
  },
  photoActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#25C1AC',
  },
  removeBtn: {
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  removeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
  saveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 14,
  },
  saveBtnDisabled: {
    backgroundColor: '#9ca3af',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  parentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
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
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  parentLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
});
