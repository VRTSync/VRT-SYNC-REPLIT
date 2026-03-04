import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  assetId?: string;
  assetName?: string;
};

const CATEGORIES = ['Irrigation', 'Landscape', 'Snow', 'Other'] as const;
const PRIORITIES = ['Normal', 'Urgent'] as const;

function generatePinPickerHTML(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #map { width: 100%; height: 100%; }
  .pin-icon {
    width: 24px; height: 24px; border-radius: 50%;
    background: #25C1AC; border: 3px solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .hint {
    position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
    z-index: 999; background: rgba(12,29,49,0.85); color: #fff;
    padding: 6px 14px; border-radius: 20px; font-size: 12px;
    font-family: -apple-system, system-ui, sans-serif; pointer-events: none;
  }
</style>
</head>
<body>
<div id="map"></div>
<div class="hint">Tap to place pin</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function() {
  var map = L.map('map', { zoomControl: false, attributionControl: false })
    .setView([${lat}, ${lng}], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);
  var marker = null;
  function post(type, data) {
    var msg = JSON.stringify({ type: type, data: data });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    else if (window.parent !== window) window.parent.postMessage(msg, '*');
  }
  map.on('click', function(e) {
    if (marker) map.removeLayer(marker);
    marker = L.marker([e.latlng.lat, e.latlng.lng], {
      icon: L.divIcon({ html: '<div class="pin-icon"></div>', className: '', iconSize: [24,24], iconAnchor: [12,12] })
    }).addTo(map);
    post('pinPlaced', { lat: e.latlng.lat, lng: e.latlng.lng });
    document.querySelector('.hint').style.display = 'none';
  });
  setTimeout(function() { map.invalidateSize(); }, 200);
})();
</script>
</body>
</html>`;
}

export default function CreateRequestSheet({ visible, onClose, assetId, assetName }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunity();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLng, setPinLng] = useState<number | null>(null);
  const [assignedTo, setAssignedTo] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topPad = Platform.OS === 'web' ? 67 + insets.top : insets.top;
  const isWeb = Platform.OS === 'web';
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

  const communityId = activeCommunity?.id;
  const { data: assetsData } = useQuery<any[]>({
    queryKey: [`/api/communities/${communityId}/assets`],
    enabled: visible && !!communityId && !assetId,
  });

  const { data: membersData } = useQuery<any[]>({
    queryKey: [`/api/communities/${communityId}/members`],
    enabled: visible && !!communityId,
  });

  const contractors = React.useMemo(() => {
    if (!membersData) return [];
    return membersData.filter((m: any) => m.role === 'contractor' || m.role === 'admin');
  }, [membersData]);

  const center = React.useMemo(() => {
    if (assetsData && assetsData.length > 0) {
      const withCoords = assetsData.filter((a: any) => a.latitude != null && a.longitude != null);
      if (withCoords.length > 0) {
        const sumLat = withCoords.reduce((s: number, a: any) => s + a.latitude, 0);
        const sumLng = withCoords.reduce((s: number, a: any) => s + a.longitude, 0);
        return { lat: sumLat / withCoords.length, lng: sumLng / withCoords.length };
      }
    }
    return { lat: 39.5, lng: -104.9 };
  }, [assetsData]);

  const communityLat = center.lat;
  const communityLng = center.lng;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('Normal');
    setCategory(undefined);
    setAssignedTo(undefined);
    setPinLat(null);
    setPinLng(null);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handlePinMessage = (msg: any) => {
    if (msg?.type === 'pinPlaced' && msg.data) {
      setPinLat(msg.data.lat);
      setPinLng(msg.data.lng);
    }
  };

  const handleWebViewMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      handlePinMessage(msg);
    } catch {}
  };

  React.useEffect(() => {
    if (!isWeb || !visible) return;
    const handler = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try { handlePinMessage(JSON.parse(event.data)); } catch {}
      } else if (event.data?.type) {
        handlePinMessage(event.data);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isWeb, visible]);

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!description.trim()) { setError('Description is required'); return; }
    if (!assetId && (pinLat === null || pinLng === null)) {
      setError('Please tap the map to place a pin'); return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body: any = {
        title: title.trim(),
        description: description.trim(),
        priority,
      };
      if (category) body.category = category;
      if (assignedTo) body.assignedTo = assignedTo;
      if (assetId) {
        body.assetId = assetId;
      } else {
        body.pinLat = pinLat;
        body.pinLng = pinLng;
      }
      await apiRequest('POST', '/api/hoa/requests', body);
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hoa'] });
      Alert.alert('Success', 'Your request has been submitted.');
      handleClose();
    } catch (e: any) {
      setError(e.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const mapHtml = generatePinPickerHTML(communityLat, communityLng);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Request</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="checkmark" size={24} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color="#e74c3c" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              placeholder="Brief summary of your request"
              placeholderTextColor="#aaa"
              value={title}
              onChangeText={setTitle}
              maxLength={200}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Provide details about the issue or request"
              placeholderTextColor="#aaa"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              maxLength={2000}
              textAlignVertical="top"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Priority</Text>
            <View style={styles.toggleRow}>
              {PRIORITIES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.toggleItem,
                    priority === p && (p === 'Normal' ? styles.toggleActiveNormal : styles.toggleActiveUrgent),
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Ionicons
                    name={p === 'Normal' ? 'flag-outline' : 'warning-outline'}
                    size={16}
                    color={priority === p ? '#fff' : '#666'}
                  />
                  <Text style={[styles.toggleText, priority === p && styles.toggleTextActive]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Category (optional)</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.categoryChip, category === c && styles.categoryChipActive]}
                  onPress={() => setCategory(category === c ? undefined : c)}
                >
                  <Text style={[styles.categoryText, category === c && styles.categoryTextActive]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {contractors.length > 0 && (
            <View style={styles.field}>
              <Text style={styles.label}>Assign To (optional)</Text>
              <View style={styles.contractorList}>
                <TouchableOpacity
                  style={[styles.contractorChip, !assignedTo && styles.contractorChipActive]}
                  onPress={() => setAssignedTo(undefined)}
                >
                  <Text style={[styles.contractorChipText, !assignedTo && styles.contractorChipTextActive]}>
                    Unassigned
                  </Text>
                </TouchableOpacity>
                {contractors.map((c: any) => (
                  <TouchableOpacity
                    key={c.userId}
                    style={[styles.contractorChip, assignedTo === c.userId && styles.contractorChipActive]}
                    onPress={() => setAssignedTo(c.userId)}
                  >
                    <Ionicons
                      name="person-outline"
                      size={14}
                      color={assignedTo === c.userId ? '#fff' : '#666'}
                    />
                    <Text style={[styles.contractorChipText, assignedTo === c.userId && styles.contractorChipTextActive]}>
                      {c.displayName || c.username}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Location</Text>
            {assetId ? (
              <View style={styles.assetLocationBox}>
                <Ionicons name="location" size={18} color="#25C1AC" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.assetLocationName}>{assetName || 'Selected Asset'}</Text>
                  <Text style={styles.assetLocationNote}>Location from asset</Text>
                </View>
              </View>
            ) : (
              <View style={styles.mapContainer}>
                {pinLat !== null && pinLng !== null && (
                  <View style={styles.pinConfirm}>
                    <Ionicons name="checkmark-circle" size={14} color="#25C1AC" />
                    <Text style={styles.pinConfirmText}>
                      Pin placed: {pinLat.toFixed(5)}, {pinLng.toFixed(5)}
                    </Text>
                  </View>
                )}
                {isWeb ? (
                  <iframe
                    ref={iframeRef as any}
                    srcDoc={mapHtml}
                    style={{ width: '100%', height: 200, border: 'none', borderRadius: 12 }}
                  />
                ) : WebView ? (
                  <WebView
                    source={{ html: mapHtml }}
                    style={styles.mapWebView}
                    onMessage={handleWebViewMessage}
                    scrollEnabled={false}
                    javaScriptEnabled
                  />
                ) : (
                  <View style={[styles.mapWebView, { justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ color: '#999' }}>Map not available</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: {
    backgroundColor: '#0C1D31',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#fff',
  },
  submitBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#25C1AC',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  formContent: {
    padding: 20,
    paddingBottom: 60,
  },
  errorBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#fdecea',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    color: '#e74c3c',
    fontSize: 13,
    fontWeight: '500' as const,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#0C1D31',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  textArea: {
    minHeight: 100,
  },
  toggleRow: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  toggleItem: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  toggleActiveNormal: {
    backgroundColor: '#25C1AC',
    borderColor: '#25C1AC',
  },
  toggleActiveUrgent: {
    backgroundColor: '#e74c3c',
    borderColor: '#e74c3c',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#666',
  },
  toggleTextActive: {
    color: '#fff',
  },
  categoryRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  categoryChipActive: {
    backgroundColor: '#0C1D31',
    borderColor: '#0C1D31',
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#666',
  },
  categoryTextActive: {
    color: '#fff',
  },
  assetLocationBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: '#E8F8F5',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#B2DFDB',
  },
  assetLocationName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#0C1D31',
  },
  assetLocationNote: {
    fontSize: 12,
    color: '#25C1AC',
    marginTop: 2,
  },
  mapContainer: {
    borderRadius: 12,
    overflow: 'hidden' as const,
    backgroundColor: '#e0e0e0',
  },
  mapWebView: {
    width: '100%' as const,
    height: 200,
    borderRadius: 12,
  },
  pinConfirm: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: 10,
    backgroundColor: '#E8F8F5',
  },
  pinConfirmText: {
    fontSize: 12,
    color: '#25C1AC',
    fontWeight: '500' as const,
  },
  contractorList: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  contractorChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  contractorChipActive: {
    backgroundColor: '#0C1D31',
    borderColor: '#0C1D31',
  },
  contractorChipText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#666',
  },
  contractorChipTextActive: {
    color: '#fff',
  },
});
