/**
 * MapCreatorChrome (MC_UX_V2)
 *
 * Replaces the legacy tile-grid + map-tap workflow with:
 *  - Semi-transparent pill bar (layer selector) at top
 *  - Canopy mode toggle (flash → leaf icon)
 *  - FAB (+) bottom-right to open AssetPickerSheet
 *  - Armed chip above FAB showing selected type + cancel
 *  - "Capture Here" button that runs a stationary-averaging GPS session
 *  - Progress ring + countdown during capture
 *  - Canopy-mode suggestion: one-time toast after 20 s yellow lock or 2 strict timeout aborts
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MC_LAYERS, MC_LAYER_MAP, type McLayerKey } from '@/lib/mcAssetTypeCatalog';
import type { CaptureMode, LockState, Fix } from '@/hooks/useHighAccuracyLocation';
import AssetPickerSheet from './AssetPickerSheet';

const LAYER_COLORS: Record<McLayerKey, string> = {
  trees: '#22c55e',
  community: '#3b82f6',
  irrigation: '#25C1AC',
};

function getCaptureColor(mode: CaptureMode, lockState: LockState): string {
  if (mode === 'canopy') {
    if (lockState === 'green') return '#06b6d4';
    if (lockState === 'yellow') return '#f59e0b';
    return '#b45309';
  }
  if (lockState === 'green') return '#22c55e';
  if (lockState === 'yellow') return '#f59e0b';
  return '#ef4444';
}

type ProgressRingProps = {
  progress: number;
  size: number;
  strokeWidth: number;
  color: string;
};

function ProgressRing({ progress, size, strokeWidth, color }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.min(1, Math.max(0, progress));
  const gap = circumference - filled;

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: color + '33',
          position: 'absolute',
        }}
      />
      <Animated.View
        style={{
          width: size - strokeWidth,
          height: size - strokeWidth,
          borderRadius: (size - strokeWidth) / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          borderTopColor: progress < 0.03 ? 'transparent' : color,
          borderRightColor: progress < 0.28 ? 'transparent' : color,
          borderBottomColor: progress < 0.53 ? 'transparent' : color,
          borderLeftColor: progress < 0.78 ? 'transparent' : color,
          position: 'absolute',
          transform: [{ rotate: `${-90 + progress * 360}deg` }],
        }}
      />
    </View>
  );
}

export type CaptureResult = {
  fix: Fix;
  sampleCount: number;
  mode: CaptureMode;
};

export type MapCreatorChromeProps = {
  activeLayer: McLayerKey;
  onLayerChange: (layer: McLayerKey) => void;
  armedType: string | null;
  onArmType: (type: string | null) => void;
  lockState: LockState;
  typeCounts: Record<string, number>;
  isLocked: boolean;
  hasControllers: boolean;
  captureMode: CaptureMode;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onCaptureHere: (mode: CaptureMode) => Promise<void>;
  isCaptureRunning: boolean;
  captureProgress: number;
  captureSamplesCount: number;
  captureTotalTarget: number;
  captureSecondsLeft: number;
  /** How many strict captures have timed out consecutively — triggers canopy suggest at 2. */
  captureTimeoutCount: number;
  /** True when zone is armed but no controller has been selected yet. */
  zoneNeedsController: boolean;
  /** Called when the user taps "Arm Controller First" shortcut. */
  onArmController: () => void;
  /** Called once (per session) to request a canopy-mode suggestion toast. */
  onCanopySuggest: () => void;
};

export default function MapCreatorChrome({
  activeLayer,
  onLayerChange,
  armedType,
  onArmType,
  lockState,
  typeCounts,
  isLocked,
  hasControllers,
  captureMode,
  onCaptureModeChange,
  onCaptureHere,
  isCaptureRunning,
  captureProgress,
  captureSamplesCount,
  captureTotalTarget,
  captureSecondsLeft,
  captureTimeoutCount,
  zoneNeedsController,
  onArmController,
  onCanopySuggest,
}: MapCreatorChromeProps) {
  const insets = useSafeAreaInsets();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [lastUsedByLayer, setLastUsedByLayer] = useState<Record<McLayerKey, string | null>>({
    trees: null,
    community: null,
    irrigation: null,
  });
  const yellowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasShownCanopySuggestRef = useRef(false);

  // After 20 s of sustained yellow lock in strict mode, fire one-time canopy suggestion.
  useEffect(() => {
    if (lockState === 'yellow' && captureMode === 'strict' && !hasShownCanopySuggestRef.current) {
      yellowTimerRef.current = setTimeout(() => {
        hasShownCanopySuggestRef.current = true;
        onCanopySuggest();
      }, 20_000);
    } else {
      if (yellowTimerRef.current) {
        clearTimeout(yellowTimerRef.current);
        yellowTimerRef.current = null;
      }
    }
    return () => {
      if (yellowTimerRef.current) {
        clearTimeout(yellowTimerRef.current);
        yellowTimerRef.current = null;
      }
    };
  }, [lockState, captureMode, onCanopySuggest]);

  // After 2 consecutive strict timeout aborts, fire one-time canopy suggestion.
  useEffect(() => {
    if (captureTimeoutCount >= 2 && captureMode === 'strict' && !hasShownCanopySuggestRef.current) {
      hasShownCanopySuggestRef.current = true;
      onCanopySuggest();
    }
  }, [captureTimeoutCount, captureMode, onCanopySuggest]);

  const layerColor = LAYER_COLORS[activeLayer];
  const armedTypeDef = armedType
    ? MC_LAYER_MAP[activeLayer]?.types.find((t) => t.key === armedType) ??
      Object.values(MC_LAYER_MAP)
        .flatMap((l) => l.types)
        .find((t) => t.key === armedType) ?? null
    : null;

  const canCapture = !isLocked && !!armedType && lockState === 'green';

  const handleLayerSelect = (key: McLayerKey) => {
    onLayerChange(key);
    onArmType(null);
  };

  const handlePickType = (typeKey: string) => {
    setLastUsedByLayer((prev) => ({ ...prev, [activeLayer]: typeKey }));
    setPickerVisible(false);
    onArmType(typeKey);
  };

  const handleCapture = async () => {
    if (!canCapture || isCaptureRunning) return;
    await onCaptureHere(captureMode);
  };


  const captureRingColor = getCaptureColor(captureMode, lockState);

  return (
    <>
      {/* Layer pill bar */}
      <View style={[styles.pillBar, { top: insets.top + 8 }]}>
        <View style={styles.pillGroup}>
          {MC_LAYERS.map((layer) => {
            const active = layer.key === activeLayer;
            const color = LAYER_COLORS[layer.key];
            return (
              <TouchableOpacity
                key={layer.key}
                style={[styles.pill, active && { backgroundColor: color, borderColor: color }]}
                onPress={() => handleLayerSelect(layer.key as McLayerKey)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={layer.icon}
                  size={13}
                  color={active ? '#fff' : '#374151'}
                />
                <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                  {layer.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Canopy mode toggle */}
        <TouchableOpacity
          style={[styles.modeToggle, captureMode === 'canopy' && styles.modeToggleCanopy]}
          onPress={() => onCaptureModeChange(captureMode === 'canopy' ? 'strict' : 'canopy')}
          activeOpacity={0.8}
        >
          <Ionicons
            name={captureMode === 'canopy' ? 'leaf' : 'flash-outline'}
            size={14}
            color={captureMode === 'canopy' ? '#06b6d4' : '#6b7280'}
          />
          <Text style={[styles.modeToggleLabel, captureMode === 'canopy' && styles.modeToggleLabelCanopy]}>
            {captureMode === 'canopy' ? '🍃 Canopy' : 'Strict'}
          </Text>
        </TouchableOpacity>
      </View>


      {/* Capture Here button and armed chip (above FAB, bottom of screen) */}
      {!isLocked && (
        <View style={[styles.captureRow, { bottom: insets.bottom + 90 }]}>
          {armedType && armedTypeDef && (
            <TouchableOpacity
              style={styles.armedChip}
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={armedTypeDef.icon}
                size={14}
                color={layerColor}
              />
              <Text style={[styles.armedChipLabel, { color: layerColor }]}>
                {armedTypeDef.label}
              </Text>
              <TouchableOpacity onPress={() => onArmType(null)} style={styles.armedChipCancel} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                <Ionicons name="close-circle" size={16} color="#9ca3af" />
              </TouchableOpacity>
            </TouchableOpacity>
          )}

          {armedType === 'zone' && zoneNeedsController && (
            <TouchableOpacity
              style={styles.armControllerBtn}
              onPress={onArmController}
              activeOpacity={0.85}
            >
              <Ionicons name="radio-button-on-outline" size={14} color="#fff" />
              <Text style={styles.armControllerBtnText}>Arm Controller First</Text>
            </TouchableOpacity>
          )}

          {armedType && (
            <TouchableOpacity
              style={[
                styles.captureBtn,
                !canCapture && styles.captureBtnDisabled,
                isCaptureRunning && styles.captureBtnRunning,
                { borderColor: captureRingColor },
              ]}
              onPress={handleCapture}
              disabled={!canCapture || isCaptureRunning}
              activeOpacity={0.85}
            >
              {isCaptureRunning ? (
                <View style={styles.captureRunningContent}>
                  <View style={styles.captureRingWrap}>
                    <ProgressRing
                      progress={captureProgress}
                      size={36}
                      strokeWidth={3}
                      color={captureRingColor}
                    />
                    <Text style={[styles.captureCountText, { color: captureRingColor }]}>
                      {captureSecondsLeft}s
                    </Text>
                  </View>
                  <Text style={[styles.captureBtnLabel, { color: captureRingColor }]}>
                    {captureSamplesCount}/{captureTotalTarget}
                  </Text>
                </View>
              ) : (
                <>
                  <Ionicons
                    name={captureMode === 'canopy' ? 'leaf' : 'location'}
                    size={18}
                    color={canCapture ? captureRingColor : '#9ca3af'}
                  />
                  <Text
                    style={[
                      styles.captureBtnLabel,
                      canCapture
                        ? { color: captureRingColor }
                        : styles.captureBtnLabelDisabled,
                    ]}
                  >
                    {lockState === 'red'
                      ? 'No GPS'
                      : lockState === 'yellow'
                      ? 'Acquiring…'
                      : captureMode === 'canopy'
                      ? 'Capture · Canopy 🍃'
                      : 'Capture Here'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* FAB */}
      {!isLocked && (
        <TouchableOpacity
          style={[
            styles.fab,
            { bottom: insets.bottom + 28, backgroundColor: armedType ? '#e5e7eb' : layerColor },
          ]}
          onPress={() => setPickerVisible(true)}
          activeOpacity={0.85}
        >
          <Ionicons
            name={armedType ? 'swap-horizontal' : 'add'}
            size={26}
            color={armedType ? '#374151' : '#fff'}
          />
        </TouchableOpacity>
      )}

      {/* Asset picker sheet */}
      <AssetPickerSheet
        visible={pickerVisible}
        activeLayer={activeLayer}
        hasControllers={hasControllers}
        lastUsedByLayer={lastUsedByLayer}
        onSelect={handlePickType}
        onClose={() => setPickerVisible(false)}
        onArmController={() => {
          setPickerVisible(false);
          onArmController();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pillBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 20,
  },
  pillGroup: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#f3f4f6',
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  pillLabelActive: {
    color: '#fff',
  },
  modeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  modeToggleCanopy: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6,182,212,0.08)',
  },
  modeToggleLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
  },
  modeToggleLabelCanopy: {
    color: '#06b6d4',
  },
  canopySuggest: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 19,
  },
  canopySuggestText: {
    flex: 1,
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  canopySuggestBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#22c55e',
    borderRadius: 8,
  },
  canopySuggestBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  canopyDismiss: {
    padding: 2,
  },
  captureRow: {
    position: 'absolute',
    left: 16,
    right: 80,
    alignItems: 'flex-start',
    gap: 8,
    zIndex: 15,
  },
  armedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  armedChipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  armedChipCancel: {
    marginLeft: 2,
  },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  captureBtnDisabled: {
    borderColor: '#e5e7eb',
    opacity: 0.6,
  },
  captureBtnRunning: {
    opacity: 1,
  },
  captureBtnLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  captureBtnLabelDisabled: {
    color: '#9ca3af',
  },
  captureRunningContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  captureRingWrap: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureCountText: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '700',
  },
  armControllerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f59e0b',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  armControllerBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  fab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 15,
  },
});
