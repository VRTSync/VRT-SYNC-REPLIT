import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Image, Modal, Dimensions,
  TextInput, FlatList, KeyboardAvoidingView, Alert,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { getQueryFn, apiRequest } from '@/lib/query-client';
import { useOffline, type PendingAssetNote } from '@/client/contexts/OfflineContext';
import { useOfflinePack } from '@/client/contexts/OfflinePackContext';
import { ASSET_FIELD_TEMPLATES, getRequiredFieldsMissing, getTemplateKeys } from '@shared/assetFieldTemplates';
import { useAuth } from '@/client/contexts/AuthContext';
import CreateRequestSheet from '@/components/CreateRequestSheet';
import Toast from '@/components/Toast';

type AssetDetail = {
  id: string;
  communityId: string;
  assetType: string;
  label: string;
  featureRef: string | null;
  geometryType: string | null;
  latitude: number | null;
  longitude: number | null;
  version: number;
  tags: string[];
  createdBy: string | null;
  updatedBy: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  properties: { id: string; key: string; value: string; version: number }[];
};

type HistoryEntry = {
  id: string;
  type: 'task_completion';
  completedAt: string;
  completedBy: { id: string; displayName: string };
  employeeSignOffName: string;
  notes: string | null;
  timeSpentMinutes: number | null;
  materialsUsed: string | null;
  followUpNeeded: string | null;
  task: { id: string; title: string };
  attachments: { id: string; url: string }[];
};

type AssetNoteItem = {
  id: string;
  assetId: string;
  communityId: string;
  createdBy: string;
  noteText: string;
  createdAt: string;
  creatorName: string | null;
};

type Tab = 'details' | 'history' | 'notes';

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
  pet_station: 'Pet Station', landscape_bed: 'Landscape Bed', bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area', snow_area: 'Snow Area',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatSqFt(val: string): string {
  const num = parseInt(val, 10);
  if (isNaN(num)) return val;
  return num.toLocaleString('en-US');
}

const screenWidth = Dimensions.get('window').width;

type Props = {
  assetId: string;
  onClose: () => void;
};

export default function AssetDetailPanel({ assetId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [fullScreenPhoto, setFullScreenPhoto] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCreateRequest, setShowCreateRequest] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(60);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2700);
  };

  const [tabBarHeight, setTabBarHeight] = useState(44);
  const [webKeyboardHeight, setWebKeyboardHeight] = useState(0);
  const { isOnline, addPendingAssetNote, syncPendingAssetNotes, getPendingNotesForAsset, retryAssetNote, dismissAssetNote } = useOffline();
  const { localPack, getOfflineWorkHistory } = useOfflinePack();
  const useOfflineData = !isOnline && !!localPack;
  const isHoaAdmin = user?.role === 'hoa_admin';

  const { data: asset, isLoading: assetLoading, error: assetError } = useQuery<AssetDetail>({
    queryKey: [`/api/assets/${assetId}`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!assetId,
  });

  const { data: onlineHistory = [], isLoading: historyLoading } = useQuery<HistoryEntry[]>({
    queryKey: [`/api/assets/${assetId}/history`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!assetId && activeTab === 'history' && !useOfflineData,
  });

  const offlineHistory = useMemo(() => {
    if (!useOfflineData || !assetId) return [];
    return (getOfflineWorkHistory(assetId) || []) as HistoryEntry[];
  }, [useOfflineData, assetId, localPack]);

  const history = useOfflineData ? offlineHistory : onlineHistory;

  const { data: serverNotes = [], isLoading: notesLoading } = useQuery<AssetNoteItem[]>({
    queryKey: [`/api/assets/${assetId}/notes`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!assetId && activeTab === 'notes' && isOnline,
  });

  const pendingNotes = getPendingNotesForAsset(assetId);

  const handleSubmitNote = async () => {
    const text = noteText.trim();
    if (!text || submitting) return;

    if (isOnline) {
      setSubmitting(true);
      try {
        await apiRequest('POST', `/api/assets/${assetId}/notes`, { noteText: text });
        setNoteText('');
        queryClient.invalidateQueries({ queryKey: [`/api/assets/${assetId}/notes`] });
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to save note');
      } finally {
        setSubmitting(false);
      }
    } else {
      const id = Crypto.randomUUID();
      await addPendingAssetNote({
        id,
        assetId,
        communityId: asset?.communityId || '',
        noteText: text,
        createdAt: new Date().toISOString(),
        idempotencyKey: id,
      });
      setNoteText('');
      Alert.alert('Saved Offline', 'Your note will be synced when you are back online.');
    }
  };

  const topPad = Platform.OS === 'web' ? 67 + insets.top : insets.top;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const keyboardH = window.innerHeight - vv.height - vv.offsetTop;
      setWebKeyboardHeight(Math.max(0, keyboardH));
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  const keyboardVerticalOffset = insets.top + headerHeight + tabBarHeight;

  const [rawPropsExpanded, setRawPropsExpanded] = useState(false);

  const sqFtProp = asset?.properties.find(p => p.key === 'sqFt');
  const hasTags = asset?.tags && asset.tags.length > 0;
  const hasAudit = asset?.createdByName || asset?.updatedByName;
  const template = asset ? ASSET_FIELD_TEMPLATES[asset.assetType] : undefined;
  const missingInfo = asset ? getRequiredFieldsMissing(asset.assetType, asset.properties) : { count: 0, fields: [] };
  const isPolygon = asset?.geometryType === 'polygon' || asset?.geometryType === 'multipolygon';
  const templateKeys = asset ? getTemplateKeys(asset.assetType) : new Set<string>();
  const rawProps = asset?.properties.filter(p => !templateKeys.has(p.key)) || [];

  const getPropValue = (key: string): string | null => {
    const prop = asset?.properties.find(p => p.key === key);
    return prop?.value?.trim() || null;
  };

  const renderDetailsTab = () => (
    <ScrollView contentContainerStyle={styles.tabContent}>
      {missingInfo.count > 0 && (
        <View style={styles.missingBanner}>
          <Ionicons name="warning-outline" size={16} color="#e67e22" />
          <Text style={styles.missingBannerText}>
            {missingInfo.count} required field{missingInfo.count > 1 ? 's' : ''} missing
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Identity</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Label</Text>
          <Text style={styles.detailValue}>{asset?.label}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Type</Text>
          <Text style={styles.detailValue}>{template?.displayName || ASSET_TYPE_LABELS[asset?.assetType || ''] || asset?.assetType}</Text>
        </View>
        {asset?.featureRef && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Feature Ref</Text>
            <Text style={styles.detailValue}>{asset.featureRef}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Geometry</Text>
        {asset?.geometryType && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={styles.detailValue}>{asset.geometryType}</Text>
          </View>
        )}
        {asset?.latitude != null && asset?.longitude != null && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue}>
              {asset.latitude.toFixed(6)}, {asset.longitude.toFixed(6)}
            </Text>
          </View>
        )}
      </View>

      {isPolygon && (
        <View style={[styles.card, styles.sqFtCard]}>
          <View style={styles.sqFtRow}>
            <Ionicons name="resize-outline" size={22} color="#25C1AC" />
            {sqFtProp ? (
              <>
                <Text style={styles.sqFtValue}>{formatSqFt(sqFtProp.value)}</Text>
                <Text style={styles.sqFtLabel}>sq ft</Text>
              </>
            ) : (
              <Text style={styles.sqFtMissing}>Area not calculated</Text>
            )}
          </View>
        </View>
      )}

      {template && template.sections.map((section) => (
        <View key={section.title} style={styles.card}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.fields.map((field) => {
            const value = getPropValue(field.key);
            const isMissing = field.required && !value;
            return (
              <View key={field.key} style={styles.detailRow}>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.detailLabel}>{field.label}</Text>
                  {field.required && (
                    <Text style={styles.requiredStar}>*</Text>
                  )}
                </View>
                {isMissing ? (
                  <View style={styles.missingBadge}>
                    <Text style={styles.missingBadgeText}>Missing</Text>
                  </View>
                ) : (
                  <Text style={styles.detailValue}>{value || '—'}</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}

      {hasTags && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <View style={styles.tagsContainer}>
            {asset!.tags.map((tag, idx) => (
              <View key={idx} style={styles.tagChip}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {hasAudit && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Audit Trail</Text>
          {asset!.createdByName && (
            <View style={styles.auditRow}>
              <View style={styles.auditIconWrap}>
                <Ionicons name="person-add-outline" size={16} color="#25C1AC" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.auditLabel}>Created by</Text>
                <Text style={styles.auditValue}>{asset!.createdByName}</Text>
                <Text style={styles.auditDate}>{formatDateTime(asset!.createdAt)}</Text>
              </View>
            </View>
          )}
          {asset!.updatedByName && (
            <View style={styles.auditRow}>
              <View style={styles.auditIconWrap}>
                <Ionicons name="create-outline" size={16} color="#F59E0B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.auditLabel}>Updated by</Text>
                <Text style={styles.auditValue}>{asset!.updatedByName}</Text>
                <Text style={styles.auditDate}>{formatDateTime(asset!.updatedAt)}</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {rawProps.length > 0 && (
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.rawPropsHeader}
            onPress={() => setRawPropsExpanded(!rawPropsExpanded)}
          >
            <Text style={styles.sectionTitle}>Raw Properties</Text>
            <Ionicons name={rawPropsExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#999" />
          </TouchableOpacity>
          {rawPropsExpanded && rawProps.map((p) => (
            <View key={p.id} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{p.key}</Text>
              <Text style={styles.detailValue}>{p.value}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );

  const renderHistoryEntry = ({ item }: { item: HistoryEntry }) => (
    <View style={styles.entryCard}>
      <View style={styles.entryHeader}>
        <View style={styles.dateBadge}>
          <Ionicons name="calendar-outline" size={14} color="#25C1AC" />
          <Text style={styles.dateText}>{formatDate(item.completedAt)}</Text>
          <Text style={styles.timeText}>{formatTime(item.completedAt)}</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.taskLink}
        onPress={() => { onClose(); router.push(`/task/${item.task.id}` as any); }}
      >
        <Ionicons name="clipboard-outline" size={16} color="#0C1D31" />
        <Text style={styles.taskTitle} numberOfLines={2}>{item.task.title}</Text>
        <Ionicons name="chevron-forward" size={14} color="#ccc" />
      </TouchableOpacity>
      <View style={styles.entryMeta}>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color="#666" />
          <Text style={styles.metaText}>{item.employeeSignOffName || item.completedBy.displayName}</Text>
        </View>
        {item.timeSpentMinutes != null && (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color="#666" />
            <Text style={styles.metaText}>{item.timeSpentMinutes} min</Text>
          </View>
        )}
      </View>
      {item.notes ? (
        <View style={styles.notesSection}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{item.notes}</Text>
        </View>
      ) : null}
      {item.materialsUsed ? (
        <View style={styles.notesSection}>
          <Text style={styles.notesLabel}>Materials</Text>
          <Text style={styles.notesText}>{item.materialsUsed}</Text>
        </View>
      ) : null}
      {item.followUpNeeded ? (
        <View style={styles.followUpBadge}>
          <Ionicons name="flag-outline" size={14} color="#f57c00" />
          <Text style={styles.followUpText}>Follow-up: {item.followUpNeeded}</Text>
        </View>
      ) : null}
      {item.attachments.length > 0 && (
        <View style={styles.photosRow}>
          {item.attachments.map((a) => (
            <TouchableOpacity key={a.id} onPress={() => setFullScreenPhoto(a.url)} style={styles.photoThumb}>
              <Image source={{ uri: a.url }} style={styles.photoImage} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderHistoryTab = () => {
    if (historyLoading && !useOfflineData) {
      return <View style={styles.center}><ActivityIndicator color="#25C1AC" size="large" /></View>;
    }
    if (history.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={48} color="#ddd" />
          <Text style={styles.emptyTitle}>No work history yet</Text>
          <Text style={styles.emptySubtitle}>Completed tasks linked to this asset will appear here</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        renderItem={renderHistoryEntry}
        contentContainerStyle={styles.tabContent}
        scrollEnabled={!!history.length}
      />
    );
  };

  const stateLabel = (state: PendingAssetNote['state']) => {
    switch (state) {
      case 'queued': return 'Queued';
      case 'syncing': return 'Syncing...';
      case 'failed': return 'Sync Error';
      default: return state;
    }
  };

  const stateColor = (state: PendingAssetNote['state']) => {
    switch (state) {
      case 'queued': return '#f39c12';
      case 'syncing': return '#3498db';
      case 'failed': return '#e74c3c';
      default: return '#999';
    }
  };

  const renderNotesTab = () => {
    const allNotes: { type: 'server' | 'pending'; data: any }[] = [
      ...pendingNotes.map(n => ({ type: 'pending' as const, data: n })),
      ...serverNotes.map(n => ({ type: 'server' as const, data: n })),
    ];

    const noteInputBarStyle = Platform.OS === 'web'
      ? [styles.noteInputBar, { paddingBottom: 10 }]
      : styles.noteInputBar;

    const renderNotesList = () => {
      if (notesLoading && isOnline) {
        return <View style={styles.center}><ActivityIndicator color="#25C1AC" size="large" /></View>;
      }
      if (allNotes.length === 0) {
        return (
          <View style={styles.notesEmptyState}>
            <Ionicons name="chatbubble-outline" size={48} color="#ddd" />
            <Text style={styles.emptyTitle}>No notes yet</Text>
            <Text style={styles.emptySubtitle}>Add a note about this asset</Text>
          </View>
        );
      }
      return (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.tabContent}
          keyboardShouldPersistTaps="handled"
        >
          {allNotes.map((item) => {
            if (item.type === 'pending') {
              const n = item.data as PendingAssetNote;
              return (
                <View key={n.id} style={[styles.noteCard, styles.noteCardPending]}>
                  <View style={styles.noteHeader}>
                    <View style={styles.noteBadgeWrapper}>
                      <View style={[styles.stateBadge, { backgroundColor: stateColor(n.state) + '20', borderColor: stateColor(n.state) }]}>
                        <Text style={[styles.stateBadgeText, { color: stateColor(n.state) }]}>{stateLabel(n.state)}</Text>
                      </View>
                    </View>
                    <Text style={styles.noteDate}>{formatDateTime(n.createdAt)}</Text>
                  </View>
                  <Text style={styles.noteText}>{n.noteText}</Text>
                  {n.state === 'failed' && (
                    <View style={styles.noteActions}>
                      {n.lastError && <Text style={styles.errorText}>{n.lastError}</Text>}
                      <View style={styles.noteActionRow}>
                        <TouchableOpacity style={styles.retryBtn} onPress={() => retryAssetNote(n.id)}>
                          <Ionicons name="refresh-outline" size={14} color="#fff" />
                          <Text style={styles.retryBtnText}>Retry</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.dismissBtn} onPress={() => dismissAssetNote(n.id)}>
                          <Text style={styles.dismissBtnText}>Dismiss</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            } else {
              const n = item.data as AssetNoteItem;
              const canDelete = user?.role === 'admin' || n.createdBy === user?.id;
              return (
                <View key={n.id} style={styles.noteCard}>
                  <View style={styles.noteHeader}>
                    <View style={styles.noteCreator}>
                      <Ionicons name="person-circle-outline" size={18} color="#25C1AC" />
                      <Text style={styles.noteCreatorName} numberOfLines={1} ellipsizeMode="tail">{n.creatorName || 'Unknown'}</Text>
                    </View>
                    <View style={styles.noteHeaderRight}>
                      <Text style={styles.noteDate}>{formatDateTime(n.createdAt)}</Text>
                      {canDelete && (
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert(
                              'Delete Note',
                              'Are you sure you want to delete this note?',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: async () => {
                                    try {
                                      await apiRequest('DELETE', `/api/assets/${assetId}/notes/${n.id}`);
                                      queryClient.invalidateQueries({ queryKey: [`/api/assets/${assetId}/notes`] });
                                    } catch (e: any) {
                                      Alert.alert('Error', e.message || 'Failed to delete note');
                                    }
                                  },
                                },
                              ]
                            );
                          }}
                          style={styles.noteDeleteBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="trash-outline" size={16} color="#e74c3c" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  <Text style={styles.noteText}>{n.noteText}</Text>
                </View>
              );
            }
          })}
        </ScrollView>
      );
    };

    const inputBar = (
      <View style={noteInputBarStyle}>
        <TextInput
          style={styles.noteInput}
          placeholder="Add a note..."
          placeholderTextColor="#999"
          value={noteText}
          onChangeText={setNoteText}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.noteSendBtn, (!noteText.trim() || submitting) && styles.noteSendBtnDisabled]}
          onPress={handleSubmitNote}
          disabled={!noteText.trim() || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    );

    if (Platform.OS === 'web') {
      return (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: webKeyboardHeight }}
          keyboardShouldPersistTaps="handled"
        >
          {notesLoading && isOnline ? (
            <View style={styles.center}><ActivityIndicator color="#25C1AC" size="large" /></View>
          ) : allNotes.length === 0 ? (
            <View style={styles.notesEmptyState}>
              <Ionicons name="chatbubble-outline" size={48} color="#ddd" />
              <Text style={styles.emptyTitle}>No notes yet</Text>
              <Text style={styles.emptySubtitle}>Add a note about this asset</Text>
            </View>
          ) : (
            <View style={styles.tabContent}>
              {allNotes.map((item) => {
                if (item.type === 'pending') {
                  const n = item.data as PendingAssetNote;
                  return (
                    <View key={n.id} style={[styles.noteCard, styles.noteCardPending]}>
                      <View style={styles.noteHeader}>
                        <View style={styles.noteBadgeWrapper}>
                          <View style={[styles.stateBadge, { backgroundColor: stateColor(n.state) + '20', borderColor: stateColor(n.state) }]}>
                            <Text style={[styles.stateBadgeText, { color: stateColor(n.state) }]}>{stateLabel(n.state)}</Text>
                          </View>
                        </View>
                        <Text style={styles.noteDate}>{formatDateTime(n.createdAt)}</Text>
                      </View>
                      <Text style={styles.noteText}>{n.noteText}</Text>
                      {n.state === 'failed' && (
                        <View style={styles.noteActions}>
                          {n.lastError && <Text style={styles.errorText}>{n.lastError}</Text>}
                          <View style={styles.noteActionRow}>
                            <TouchableOpacity style={styles.retryBtn} onPress={() => retryAssetNote(n.id)}>
                              <Ionicons name="refresh-outline" size={14} color="#fff" />
                              <Text style={styles.retryBtnText}>Retry</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.dismissBtn} onPress={() => dismissAssetNote(n.id)}>
                              <Text style={styles.dismissBtnText}>Dismiss</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                } else {
                  const n = item.data as AssetNoteItem;
                  return (
                    <View key={n.id} style={styles.noteCard}>
                      <View style={styles.noteHeader}>
                        <View style={styles.noteCreator}>
                          <Ionicons name="person-circle-outline" size={18} color="#25C1AC" />
                          <Text style={styles.noteCreatorName} numberOfLines={1} ellipsizeMode="tail">{n.creatorName || 'Unknown'}</Text>
                        </View>
                        <Text style={styles.noteDate}>{formatDateTime(n.createdAt)}</Text>
                      </View>
                      <Text style={styles.noteText}>{n.noteText}</Text>
                    </View>
                  );
                }
              })}
            </View>
          )}
          {inputBar}
        </ScrollView>
      );
    }

    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {renderNotesList()}
        {inputBar}
      </KeyboardAvoidingView>
    );
  };

  if (assetLoading) {
    return (
      <Modal visible animationType="slide" presentationStyle="fullScreen">
        <View style={[styles.container, { paddingTop: topPad }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Loading...</Text>
          </View>
          <View style={styles.center}>
            <ActivityIndicator color="#25C1AC" size="large" />
          </View>
        </View>
      </Modal>
    );
  }

  if (assetError || !asset) {
    return (
      <Modal visible animationType="slide" presentationStyle="fullScreen">
        <View style={[styles.container, { paddingTop: topPad }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Not Found</Text>
          </View>
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>
              {assetError ? 'Failed to load asset details' : 'Asset not found'}
            </Text>
            <TouchableOpacity onPress={onClose} style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#25C1AC', borderRadius: 8 }}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View
          style={styles.header}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{asset.label}</Text>
            <Text style={styles.headerSubtitle}>
              {ASSET_TYPE_LABELS[asset.assetType] || asset.assetType}
            </Text>
          </View>
          {!isOnline && (
            <View style={styles.offlineBadge}>
              <Ionicons name="cloud-offline-outline" size={14} color="#f39c12" />
              <Text style={styles.offlineBadgeText}>Offline</Text>
            </View>
          )}
          {isHoaAdmin && (
            <TouchableOpacity
              onPress={() => setShowCreateRequest(true)}
              style={styles.createRequestBtn}
            >
              <Ionicons name="add-circle-outline" size={22} color="#25C1AC" />
            </TouchableOpacity>
          )}
        </View>

        <View
          style={styles.tabBar}
          onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}
        >
          {(['details', 'history', 'notes'] as Tab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Ionicons
                name={tab === 'details' ? 'information-circle-outline' : tab === 'history' ? 'time-outline' : 'chatbubble-outline'}
                size={16}
                color={activeTab === tab ? '#25C1AC' : '#999'}
              />
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'details' ? 'Details' : tab === 'history' ? 'History' : 'Notes'}
              </Text>
              {tab === 'notes' && pendingNotes.length > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{pendingNotes.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ flex: 1 }}>
          {activeTab === 'details' && renderDetailsTab()}
          {activeTab === 'history' && renderHistoryTab()}
          {activeTab === 'notes' && renderNotesTab()}
        </View>

        <Modal visible={!!fullScreenPhoto} transparent animationType="fade">
          <View style={styles.photoModal}>
            <TouchableOpacity
              style={[styles.photoCloseBtn, Platform.OS === 'web' && { top: topPad + 12 }]}
              onPress={() => setFullScreenPhoto(null)}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            {fullScreenPhoto && (
              <Image source={{ uri: fullScreenPhoto }} style={styles.fullPhoto} resizeMode="contain" />
            )}
          </View>
        </Modal>
        <CreateRequestSheet
          visible={showCreateRequest}
          onClose={() => setShowCreateRequest(false)}
          onSuccess={() => showToast('Request submitted successfully')}
          assetId={assetId}
          assetName={asset?.label}
          assetLat={asset?.latitude ?? undefined}
          assetLng={asset?.longitude ?? undefined}
        />
        <Toast visible={toastVisible} message={toastMessage} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  notesEmptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  header: {
    backgroundColor: '#0C1D31',
    flexDirection: 'row',
    alignItems: 'center',
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  headerSubtitle: { fontSize: 13, color: '#25C1AC', marginTop: 2, fontWeight: '500' },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(243,156,18,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  offlineBadgeText: { fontSize: 11, color: '#f39c12', fontWeight: '600' },
  createRequestBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(37,193,172,0.15)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#25C1AC',
  },
  tabText: { fontSize: 14, fontWeight: '500', color: '#999' },
  tabTextActive: { color: '#25C1AC', fontWeight: '600' },
  tabBadge: {
    backgroundColor: '#f39c12',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  tabContent: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0C1D31', marginBottom: 12 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  detailValue: { fontSize: 14, color: '#333', fontWeight: '400', maxWidth: '60%', textAlign: 'right' },
  sqFtCard: { backgroundColor: '#E8F8F5', borderWidth: 1, borderColor: '#B2DFDB' },
  sqFtRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sqFtValue: { fontSize: 22, fontWeight: '700', color: '#0C1D31' },
  sqFtLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    backgroundColor: '#E0F7FA',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#B2EBF2',
  },
  tagText: { fontSize: 13, color: '#00838F', fontWeight: '600' },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  auditIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f4f8',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  auditLabel: { fontSize: 12, color: '#999', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  auditValue: { fontSize: 14, color: '#333', fontWeight: '600', marginTop: 1 },
  auditDate: { fontSize: 12, color: '#888', marginTop: 2 },
  entryCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  dateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateText: { fontSize: 14, fontWeight: '600', color: '#0C1D31' },
  timeText: { fontSize: 13, color: '#999' },
  taskLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  taskTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0C1D31' },
  entryMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: '#666' },
  notesSection: { marginTop: 8 },
  notesLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginBottom: 2, textTransform: 'uppercase' },
  notesText: { fontSize: 14, color: '#333', lineHeight: 20 },
  followUpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  followUpText: { fontSize: 13, color: '#f57c00', fontWeight: '500' },
  photosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photoThumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: '#eee' },
  photoImage: { width: '100%', height: '100%' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#999', marginTop: 4, textAlign: 'center' },
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  noteCardPending: {
    borderLeftWidth: 3,
    borderLeftColor: '#f39c12',
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  noteCreator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  noteBadgeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  noteCreatorName: { fontSize: 14, fontWeight: '600', color: '#0C1D31', flexShrink: 1 },
  noteDate: { fontSize: 12, color: '#999', flexShrink: 0 },
  noteHeaderRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  noteDeleteBtn: {
    padding: 2,
  },
  noteText: { fontSize: 14, color: '#333', lineHeight: 20 },
  stateBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
  },
  stateBadgeText: { fontSize: 11, fontWeight: '600' },
  noteActions: { marginTop: 8 },
  errorText: { fontSize: 12, color: '#e74c3c', marginBottom: 6 },
  noteActionRow: { flexDirection: 'row', gap: 8 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#25C1AC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  dismissBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  dismissBtnText: { fontSize: 13, fontWeight: '500', color: '#999' },
  noteInputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e8e8e8',
    backgroundColor: '#fff',
  },
  noteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    maxHeight: 100,
    backgroundColor: '#f9f9f9',
  },
  noteSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#25C1AC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noteSendBtnDisabled: { opacity: 0.4 },
  photoModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullPhoto: {
    width: screenWidth - 32,
    height: screenWidth - 32,
  },
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#f5c542',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  missingBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e67e22',
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  requiredStar: {
    fontSize: 14,
    color: '#e74c3c',
    fontWeight: '700',
  },
  missingBadge: {
    backgroundColor: '#fdecea',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#f5c6cb',
  },
  missingBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c0392b',
  },
  sqFtMissing: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  rawPropsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
