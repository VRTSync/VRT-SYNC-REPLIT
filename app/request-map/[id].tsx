import React from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import StatusBarFill from '@/components/StatusBarFill';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

function generateRequestMapHTML(lat: number, lng: number, title: string, priority: string, status: string, taskId: string): string {
  const escaped = (s: string) => s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const priorityColor = priority === 'urgent' ? '#e74c3c' : '#25C1AC';
  const priorityLabel = priority === 'urgent' ? 'Urgent' : 'Normal';
  const statusLabel = status === 'submitted' ? 'Submitted' : status === 'acknowledged' ? 'Acknowledged' : status === 'completed' ? 'Completed' : status.charAt(0).toUpperCase() + status.slice(1);

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #map { width: 100%; height: 100%; }
  .request-marker {
    width: 32px; height: 32px; position: relative;
  }
  .request-marker-inner {
    width: 32px; height: 32px; border-radius: 50% 50% 50% 0;
    background: ${priorityColor}; border: 3px solid #fff;
    box-shadow: 0 3px 12px rgba(0,0,0,0.35);
    transform: rotate(-45deg);
    display: flex; align-items: center; justify-content: center;
  }
  .request-marker-icon {
    transform: rotate(45deg);
    color: #fff; font-size: 14px; font-weight: bold;
  }
  .leaflet-popup-content-wrapper {
    border-radius: 12px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
  }
  .popup-content {
    font-family: -apple-system, system-ui, sans-serif;
    min-width: 180px;
  }
  .popup-label {
    font-size: 10px; font-weight: 700; letter-spacing: 1px;
    color: ${priorityColor}; margin-bottom: 4px;
  }
  .popup-title {
    font-size: 14px; font-weight: 600; color: #0C1D31;
    margin-bottom: 8px; line-height: 1.3;
  }
  .popup-row {
    display: flex; gap: 8px; margin-bottom: 4px;
  }
  .popup-badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600;
  }
  .popup-priority {
    background: ${priorityColor}20; color: ${priorityColor};
  }
  .popup-status {
    background: #0C1D3115; color: #0C1D31;
  }
  .popup-open-btn {
    display: block; margin-top: 10px; padding: 8px 0;
    text-align: center; background: #0C1D31; color: #fff;
    border-radius: 8px; font-size: 13px; font-weight: 600;
    text-decoration: none; cursor: pointer; border: none; width: 100%;
  }
  .user-dot {
    width: 14px; height: 14px; border-radius: 50%;
    background: #4285F4; border: 3px solid #fff;
    box-shadow: 0 1px 6px rgba(66,133,244,0.5);
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function() {
  var map = L.map('map', { zoomControl: false, attributionControl: false })
    .setView([${lat}, ${lng}], 17);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);

  var markerIcon = L.divIcon({
    html: '<div class="request-marker"><div class="request-marker-inner"><span class="request-marker-icon">!</span></div></div>',
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34]
  });

  var marker = L.marker([${lat}, ${lng}], { icon: markerIcon }).addTo(map);
  marker.bindPopup(
    '<div class="popup-content">' +
      '<div class="popup-label">HOA REQUEST</div>' +
      '<div class="popup-title">${escaped(title)}</div>' +
      '<div class="popup-row">' +
        '<span class="popup-badge popup-priority">${priorityLabel}</span>' +
        '<span class="popup-badge popup-status">${statusLabel}</span>' +
      '</div>' +
      '<button class="popup-open-btn" onclick="openRequest()">Open Request</button>' +
    '</div>',
    { closeButton: true, maxWidth: 240 }
  );

  function openRequest() {
    var msg = JSON.stringify({ type: 'openRequest', data: { id: '${taskId}' } });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    else if (window.parent !== window) window.parent.postMessage(msg, '*');
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function(pos) {
      var userIcon = L.divIcon({
        html: '<div class="user-dot"></div>',
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker([pos.coords.latitude, pos.coords.longitude], { icon: userIcon, interactive: false }).addTo(map);
    }, function() {}, { enableHighAccuracy: false, timeout: 5000 });
  }

  setTimeout(function() { map.invalidateSize(); }, 200);
})();
</script>
</body>
</html>`;
}

export default function RequestMapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';

  const { data: request, isLoading, error } = useQuery<any>({
    queryKey: [`/api/hoa/requests/${id}`],
    enabled: !!id,
  });

  const handleWebViewMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg?.type === 'openRequest') {
        router.back();
      }
    } catch {}
  };

  React.useEffect(() => {
    if (!isWeb) return;
    const handler = (event: MessageEvent) => {
      try {
        const raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (raw?.type === 'openRequest') {
          router.back();
        }
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isWeb]);

  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  const pinLat = request?.pinLocation?.lat;
  const pinLng = request?.pinLocation?.lng;
  const hasLocation = pinLat != null && pinLng != null;

  const mapHtml = hasLocation
    ? generateRequestMapHTML(
        pinLat,
        pinLng,
        request?.title ?? 'Request',
        request?.priority ?? 'Normal',
        request?.status ?? 'submitted',
        id ?? ''
      )
    : '';

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request Map</Text>
        <View style={{ width: 36 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
          <Text style={styles.errorText}>Failed to load request</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : !hasLocation ? (
        <View style={styles.centered}>
          <Ionicons name="location-outline" size={48} color="#999" />
          <Text style={styles.noLocationText}>No location data available</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.mapWrapper, { paddingBottom: bottomPad }]}>
          {isWeb ? (
            <iframe
              srcDoc={mapHtml}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          ) : WebView ? (
            <WebView
              source={{ html: mapHtml }}
              style={styles.map}
              onMessage={handleWebViewMessage}
              javaScriptEnabled
              scrollEnabled={false}
            />
          ) : (
            <View style={[styles.map, styles.centered]}>
              <Text style={{ color: '#999' }}>Map not available</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0C1D31',
  },
  header: {
    backgroundColor: '#0C1D31',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: {
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
    textAlign: 'center' as const,
  },
  mapWrapper: {
    flex: 1,
    backgroundColor: '#e0e0e0',
  },
  map: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: '#f5f7fa',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#e74c3c',
  },
  noLocationText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#666',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#0C1D31',
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
