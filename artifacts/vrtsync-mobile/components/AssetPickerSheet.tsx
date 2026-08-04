import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  IRRIGATION_CONTROLLERS_ZONE_KEYS,
  getTypeIcon,
  type McLayerKey,
  type McAssetType,
} from '@/lib/mcAssetTypeCatalog';
import { useAssetTypes } from '@/client/contexts/AssetTypeContext';

type Props = {
  visible: boolean;
  activeLayer: string;
  hasControllers: boolean;
  lastUsedByLayer: Record<string, string | null>;
  onSelect: (typeKey: string) => void;
  onClose: () => void;
  onArmController?: () => void;
};

export default function AssetPickerSheet({
  visible,
  activeLayer,
  hasControllers,
  lastUsedByLayer,
  onSelect,
  onClose,
  onArmController,
}: Props) {
  const insets = useSafeAreaInsets();
  const { assetTypes } = useAssetTypes();
  const layerTypes: McAssetType[] = useMemo(
    () => assetTypes
      .filter(t => t.layerKey === activeLayer)
      .map(t => ({ key: t.key, label: t.label, icon: getTypeIcon(t.key) })),
    [assetTypes, activeLayer],
  );
  const layerLabel = useMemo(() => {
    const LAYER_LABELS: Record<string, string> = {
      trees: 'Trees', community: 'Community', irrigation: 'Irrigation', snow: 'Snow',
    };
    return LAYER_LABELS[activeLayer] ?? (activeLayer.charAt(0).toUpperCase() + activeLayer.slice(1));
  }, [activeLayer]);
  const highlighted = lastUsedByLayer[activeLayer] ?? null;

  const renderTile = (type: McAssetType, disabled = false) => {
    const isHighlighted = highlighted === type.key;
    return (
      <TouchableOpacity
        key={type.key}
        style={[
          styles.tile,
          isHighlighted && styles.tileHighlighted,
          disabled && styles.tileDisabled,
        ]}
        onPress={() => !disabled && onSelect(type.key)}
        activeOpacity={disabled ? 1 : 0.75}
        disabled={disabled}
      >
        <Ionicons
          name={type.icon}
          size={22}
          color={disabled ? '#c4c4c4' : isHighlighted ? '#25C1AC' : '#374151'}
        />
        <Text
          style={[
            styles.tileLabel,
            isHighlighted && styles.tileLabelHighlighted,
            disabled && styles.tileLabelDisabled,
          ]}
          numberOfLines={2}
        >
          {type.label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderIrrigationContent = () => {
    const ctrlZoneTypes = layerTypes.filter(t => IRRIGATION_CONTROLLERS_ZONE_KEYS.has(t.key));
    const otherTypes = layerTypes.filter(t => !IRRIGATION_CONTROLLERS_ZONE_KEYS.has(t.key));
    return (
      <>
        <Text style={styles.groupHeader}>Controllers & Zones</Text>
        <View style={styles.tileRow}>
          {ctrlZoneTypes.map((type) => {
            if (type.key === 'zone') {
              const disabled = !hasControllers;
              return (
                <View key={type.key} style={styles.tileWrap}>
                  {renderTile(type, disabled)}
                  {disabled && (
                    <TouchableOpacity
                      style={styles.armControllerCta}
                      onPress={() => { onArmController?.(); onClose(); }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="radio-button-on-outline" size={11} color="#fff" />
                      <Text style={styles.armControllerCtaText}>Arm Controller First</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            }
            return <View key={type.key} style={styles.tileWrap}>{renderTile(type)}</View>;
          })}
        </View>
        {otherTypes.length > 0 && (
          <>
            <Text style={styles.groupHeader}>Valves, Meters & Fittings</Text>
            <View style={styles.tileRow}>
              {otherTypes.map((type) => (
                <View key={type.key} style={styles.tileWrap}>{renderTile(type)}</View>
              ))}
            </View>
          </>
        )}
      </>
    );
  };

  const renderFlatContent = () => (
    <View style={styles.tileRow}>
      {layerTypes.map((type) => (
        <View key={type.key} style={styles.tileWrap}>{renderTile(type)}</View>
      ))}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {layerLabel}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {activeLayer === 'irrigation'
              ? renderIrrigationContent()
              : renderFlatContent()}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
    maxHeight: '75%',
    paddingTop: 10,
    paddingHorizontal: 16,
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
    marginBottom: 14,
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
  groupHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 8,
  },
  tileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tileWrap: {
    width: '30%',
    flexGrow: 1,
  },
  tile: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
    minHeight: 80,
    justifyContent: 'center',
  },
  tileHighlighted: {
    borderColor: '#25C1AC',
    backgroundColor: 'rgba(37,193,172,0.07)',
  },
  tileDisabled: {
    backgroundColor: '#f3f4f6',
    opacity: 0.6,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
    lineHeight: 14,
  },
  tileLabelHighlighted: {
    color: '#25C1AC',
  },
  tileLabelDisabled: {
    color: '#9ca3af',
  },
  armControllerCta: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#25C1AC',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignSelf: 'center',
  },
  armControllerCtaText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
});
