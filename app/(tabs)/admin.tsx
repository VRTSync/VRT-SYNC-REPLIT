import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Alert, ActivityIndicator, Platform, Modal, FlatList, Image, ImageBackground,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getQueryFn, getApiUrl } from '@/lib/query-client';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';

type AppUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
};

type Member = {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  role: string;
  joinedAt: string;
};

type CompletionDetail = {
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

type CompletedTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  address: string | null;
  completions: CompletionDetail[];
};

type AssetItem = {
  id: string;
  communityId: string;
  assetType: string;
  label: string;
  featureRef: string | null;
  geometryType: string | null;
  latitude: number | null;
  longitude: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type AssetDetail = AssetItem & {
  properties: { id: string; key: string; value: string; version: number }[];
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller',
  backflow: 'Backflow',
  zone: 'Zone',
  tree: 'Tree',
  pet_station: 'Pet Station',
  landscape_bed: 'Landscape Bed',
  bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area',
  snow_area: 'Snow Area',
};

const ASSET_TYPES = Object.keys(ASSET_TYPE_LABELS);
const GEOMETRY_TYPES = ['point', 'polygon', 'line'];

type MapLayerItem = {
  id: string;
  communityId: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

const LAYER_KEYS = ['community', 'irrigation', 'snow', 'trees'];
const LAYER_KEY_LABELS: Record<string, string> = {
  community: 'Community', irrigation: 'Irrigation', snow: 'Snow', trees: 'Trees',
};

type TabId = 'actions' | 'users' | 'members' | 'reports' | 'assets' | 'layers';

export default function AdminScreen() {
  const { user } = useAuth();
  const { activeCommunity, communities } = useCommunity();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabId>('actions');

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [showUserDetail, setShowUserDetail] = useState<AppUser | null>(null);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAddress, setTaskAddress] = useState('');
  const [taskLat, setTaskLat] = useState('');
  const [taskLng, setTaskLng] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);

  const [communityName, setCommunityName] = useState('');
  const [communityDesc, setCommunityDesc] = useState('');
  const [communitySubmitting, setCommunitySubmitting] = useState(false);

  const [showCreateAsset, setShowCreateAsset] = useState(false);
  const [showAssetDetail, setShowAssetDetail] = useState<AssetItem | null>(null);
  const [assetType, setAssetType] = useState(ASSET_TYPES[0]);
  const [assetLabel, setAssetLabel] = useState('');
  const [assetFeatureRef, setAssetFeatureRef] = useState('');
  const [assetGeometryType, setAssetGeometryType] = useState('');
  const [assetLat, setAssetLat] = useState('');
  const [assetLng, setAssetLng] = useState('');
  const [assetSubmitting, setAssetSubmitting] = useState(false);
  const [newPropKey, setNewPropKey] = useState('');
  const [newPropValue, setNewPropValue] = useState('');

  const [showCreateLayer, setShowCreateLayer] = useState(false);
  const [showLayerDetail, setShowLayerDetail] = useState<MapLayerItem | null>(null);
  const [layerKey, setLayerKey] = useState(LAYER_KEYS[0]);
  const [layerSubKey, setLayerSubKey] = useState('');
  const [layerDisplayName, setLayerDisplayName] = useState('');
  const [layerGeoJSON, setLayerGeoJSON] = useState('');
  const [layerSubmitting, setLayerSubmitting] = useState(false);
  const [replaceGeoJSON, setReplaceGeoJSON] = useState('');
  const [replacingGeoJSON, setReplacingGeoJSON] = useState(false);

  const { data: contractors = [] } = useQuery<AppUser[]>({
    queryKey: ['/api/contractors'],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: user?.role === 'admin',
  });

  const { data: allUsers = [] } = useQuery<AppUser[]>({
    queryKey: ['/api/users'],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: user?.role === 'admin',
  });

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: [`/api/communities/${activeCommunity?.id}/members`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!activeCommunity && user?.role === 'admin',
  });

  const { data: completedTasks = [] } = useQuery<CompletedTask[]>({
    queryKey: ['/api/admin/completed-tasks', { communityId: activeCommunity?.id }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/completed-tasks?communityId=${activeCommunity?.id}`);
      return res.json();
    },
    enabled: !!activeCommunity && user?.role === 'admin' && activeTab === 'reports',
  });

  const { data: assets = [] } = useQuery<AssetItem[]>({
    queryKey: [`/api/communities/${activeCommunity?.id}/assets`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!activeCommunity && user?.role === 'admin' && activeTab === 'assets',
  });

  const { data: mapLayersList = [] } = useQuery<MapLayerItem[]>({
    queryKey: ['/api/map-layers', { communityId: activeCommunity?.id }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/map-layers?communityId=${activeCommunity?.id}`);
      return res.json();
    },
    enabled: !!activeCommunity && user?.role === 'admin' && activeTab === 'layers',
  });

  const { data: assetDetail } = useQuery<AssetDetail>({
    queryKey: [`/api/assets/${showAssetDetail?.id}`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!showAssetDetail,
  });

  if (user?.role !== 'admin') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Ionicons name="lock-closed-outline" size={48} color="#ccc" />
        <Text style={styles.emptyTitle}>Admin Only</Text>
        <Text style={styles.emptySubtitle}>This section is for administrators</Text>
      </View>
    );
  }

  const handleCreateTask = async () => {
    if (!taskTitle.trim() || !activeCommunity) {
      Alert.alert('Error', 'Task title and active community are required');
      return;
    }
    setTaskSubmitting(true);
    try {
      await apiRequest('POST', '/api/tasks', {
        communityId: activeCommunity.id,
        title: taskTitle.trim(),
        description: taskDescription.trim() || undefined,
        address: taskAddress.trim() || undefined,
        latitude: taskLat ? parseFloat(taskLat) : undefined,
        longitude: taskLng ? parseFloat(taskLng) : undefined,
        priority: taskPriority,
        assignedTo: taskAssignee || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setShowCreateTask(false);
      setTaskTitle('');
      setTaskDescription('');
      setTaskAddress('');
      setTaskLat('');
      setTaskLng('');
      setTaskPriority('medium');
      setTaskAssignee('');
      Alert.alert('Success', 'Task created successfully');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create task');
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleCreateCommunity = async () => {
    if (!communityName.trim()) {
      Alert.alert('Error', 'Community name is required');
      return;
    }
    setCommunitySubmitting(true);
    try {
      await apiRequest('POST', '/api/communities', {
        name: communityName.trim(),
        description: communityDesc.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/communities'] });
      setShowCreateCommunity(false);
      setCommunityName('');
      setCommunityDesc('');
      Alert.alert('Success', 'Community created successfully');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create community');
    } finally {
      setCommunitySubmitting(false);
    }
  };

  const handleToggleRole = async (u: AppUser) => {
    if (u.id === user?.id) {
      Alert.alert('Error', 'You cannot change your own role');
      return;
    }
    const newRole = u.role === 'admin' ? 'contractor' : 'admin';
    Alert.alert(
      'Change Role',
      `Change ${u.displayName} from ${u.role} to ${newRole}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              await apiRequest('PUT', `/api/users/${u.id}/role`, { role: newRole });
              queryClient.invalidateQueries({ queryKey: ['/api/users'] });
              queryClient.invalidateQueries({ queryKey: ['/api/contractors'] });
              if (showUserDetail?.id === u.id) {
                setShowUserDetail({ ...u, role: newRole });
              }
              Alert.alert('Success', `${u.displayName} is now a ${newRole}`);
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to update role');
            }
          },
        },
      ],
    );
  };

  const handleAddToCommunity = async (userId: string, communityId: string) => {
    try {
      await apiRequest('POST', `/api/communities/${communityId}/members`, { userId });
      queryClient.invalidateQueries({ queryKey: ['/api/communities'] });
      queryClient.invalidateQueries({ queryKey: [`/api/communities/${communityId}/members`] });
      Alert.alert('Success', 'Added to community');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add to community');
    }
  };

  const handleRemoveFromCommunity = async (communityId: string, userId: string) => {
    Alert.alert('Remove Member', 'Remove this user from the community?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest('DELETE', `/api/communities/${communityId}/members/${userId}`);
            queryClient.invalidateQueries({ queryKey: ['/api/communities'] });
            queryClient.invalidateQueries({ queryKey: [`/api/communities/${communityId}/members`] });
            Alert.alert('Success', 'Removed from community');
          } catch (e: any) {
            Alert.alert('Error', e.message || 'Failed to remove from community');
          }
        },
      },
    ]);
  };

  const handleCreateAsset = async () => {
    if (!assetLabel.trim() || !activeCommunity) {
      Alert.alert('Error', 'Asset label and active community are required');
      return;
    }
    setAssetSubmitting(true);
    try {
      await apiRequest('POST', '/api/assets', {
        communityId: activeCommunity.id,
        assetType: assetType,
        label: assetLabel.trim(),
        featureRef: assetFeatureRef.trim() || undefined,
        geometryType: assetGeometryType || undefined,
        latitude: assetLat ? parseFloat(assetLat) : undefined,
        longitude: assetLng ? parseFloat(assetLng) : undefined,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/communities/${activeCommunity.id}/assets`] });
      setShowCreateAsset(false);
      setAssetType(ASSET_TYPES[0]);
      setAssetLabel('');
      setAssetFeatureRef('');
      setAssetGeometryType('');
      setAssetLat('');
      setAssetLng('');
      Alert.alert('Success', 'Asset created successfully');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create asset');
    } finally {
      setAssetSubmitting(false);
    }
  };

  const handleAddProperty = async () => {
    if (!showAssetDetail || !newPropKey.trim() || !newPropValue.trim()) {
      Alert.alert('Error', 'Key and value are required');
      return;
    }
    try {
      await apiRequest('PUT', `/api/assets/${showAssetDetail.id}/properties`, {
        properties: [{ key: newPropKey.trim(), value: newPropValue.trim() }],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/assets/${showAssetDetail.id}`] });
      setNewPropKey('');
      setNewPropValue('');
      Alert.alert('Success', 'Property added');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add property');
    }
  };

  const handleCreateLayer = async () => {
    if (!layerDisplayName.trim() || !layerSubKey.trim() || !activeCommunity) {
      Alert.alert('Error', 'Display name and sub-layer key are required');
      return;
    }
    setLayerSubmitting(true);
    try {
      await apiRequest('POST', '/api/map-layers', {
        communityId: activeCommunity.id,
        layerKey: layerKey,
        subLayerKey: layerSubKey.trim(),
        displayName: layerDisplayName.trim(),
        geojsonData: layerGeoJSON.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/map-layers'] });
      setShowCreateLayer(false);
      setLayerSubKey('');
      setLayerDisplayName('');
      setLayerGeoJSON('');
      setLayerKey(LAYER_KEYS[0]);
      Alert.alert('Success', 'Map layer created successfully');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create map layer');
    } finally {
      setLayerSubmitting(false);
    }
  };

  const handleReplaceGeoJSON = async () => {
    if (!showLayerDetail) return;
    if (!replaceGeoJSON.trim()) {
      Alert.alert('Error', 'GeoJSON data is required');
      return;
    }
    setReplacingGeoJSON(true);
    try {
      const res = await apiRequest('PATCH', `/api/map-layers/${showLayerDetail.id}`, {
        geojsonData: replaceGeoJSON.trim(),
        version: showLayerDetail.version,
      });
      const updated = await res.json();
      queryClient.invalidateQueries({ queryKey: ['/api/map-layers'] });
      setShowLayerDetail({ ...showLayerDetail, version: updated.version });
      setReplaceGeoJSON('');
      Alert.alert('Success', 'GeoJSON data updated');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update GeoJSON');
    } finally {
      setReplacingGeoJSON(false);
    }
  };

  const handleDeleteLayer = async (layer: MapLayerItem) => {
    Alert.alert('Delete Layer', `Delete "${layer.displayName}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest('DELETE', `/api/map-layers/${layer.id}`);
            queryClient.invalidateQueries({ queryKey: ['/api/map-layers'] });
            if (showLayerDetail?.id === layer.id) setShowLayerDetail(null);
            Alert.alert('Success', 'Layer deleted');
          } catch (e: any) {
            Alert.alert('Error', e.message || 'Failed to delete layer');
          }
        },
      },
    ]);
  };

  const priorities: Array<'low' | 'medium' | 'high' | 'urgent'> = ['low', 'medium', 'high', 'urgent'];
  const tabs: { id: TabId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'actions', label: 'Actions', icon: 'flash-outline' },
    { id: 'users', label: 'Users', icon: 'people-outline' },
    { id: 'members', label: 'Members', icon: 'person-circle-outline' },
    { id: 'reports', label: 'Reports', icon: 'document-text-outline' },
    { id: 'assets', label: 'Assets', icon: 'construct-outline' },
    { id: 'layers', label: 'Layers', icon: 'layers-outline' },
  ];

  const memberUserIds = new Set(members.map((m) => m.userId));

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 + insets.top : insets.top }]}>
      <ImageBackground
        source={require('@/assets/images/topography-texture.png')}
        style={styles.tabBarWrapper}
        resizeMode="cover"
      >
        <View style={styles.tabBarOverlay} />
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Ionicons
                name={tab.icon}
                size={18}
                color={activeTab === tab.id ? '#25C1AC' : 'rgba(255,255,255,0.6)'}
              />
              <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ImageBackground>

      <ScrollView contentContainerStyle={styles.content}>
        {activeTab === 'actions' && (
          <>
            <Text style={styles.pageTitle}>Admin Panel</Text>
            <Text style={styles.pageSubtitle}>{activeCommunity?.name || 'Select a community'}</Text>

            <View style={styles.actionGrid}>
              <TouchableOpacity style={styles.actionCard} onPress={() => setShowCreateTask(true)}>
                <Ionicons name="add-circle-outline" size={28} color="#25C1AC" />
                <Text style={styles.actionLabel}>Create Task</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => setShowCreateCommunity(true)}>
                <Ionicons name="business-outline" size={28} color="#4caf50" />
                <Text style={styles.actionLabel}>New Community</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quick Stats</Text>
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{allUsers.length}</Text>
                  <Text style={styles.statLabel}>Users</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{communities.length}</Text>
                  <Text style={styles.statLabel}>Communities</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{contractors.length}</Text>
                  <Text style={styles.statLabel}>Contractors</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {activeTab === 'users' && (
          <>
            <Text style={styles.pageTitle}>All Users ({allUsers.length})</Text>
            <Text style={styles.pageSubtitle}>Manage roles and community assignments</Text>

            {allUsers.map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.userCard}
                onPress={() => setShowUserDetail(u)}
              >
                <View style={[styles.memberAvatar, u.role === 'admin' ? { backgroundColor: '#9c27b0' } : { backgroundColor: '#25C1AC' }]}>
                  <Text style={styles.memberAvatarText}>{u.displayName?.charAt(0)?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{u.displayName}</Text>
                  <Text style={styles.memberRole}>@{u.username}</Text>
                </View>
                <View style={[styles.roleBadge, u.role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeContractor]}>
                  <Text style={[styles.roleBadgeText, u.role === 'admin' ? styles.roleBadgeTextAdmin : styles.roleBadgeTextContractor]}>
                    {u.role}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color="#ccc" />
              </TouchableOpacity>
            ))}
          </>
        )}

        {activeTab === 'members' && (
          <>
            <Text style={styles.pageTitle}>
              {activeCommunity?.name || 'Select a Community'}
            </Text>
            <Text style={styles.pageSubtitle}>
              {activeCommunity ? `${members.length} member${members.length !== 1 ? 's' : ''}` : 'Choose a community from your profile tab'}
            </Text>

            {activeCommunity && (
              <>
                {members.map((m) => (
                  <View key={m.id} style={styles.userCard}>
                    <View style={[styles.memberAvatar, m.role === 'admin' ? { backgroundColor: '#9c27b0' } : { backgroundColor: '#25C1AC' }]}>
                      <Text style={styles.memberAvatarText}>{m.displayName?.charAt(0)?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{m.displayName}</Text>
                      <Text style={styles.memberRole}>{m.role}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => handleRemoveFromCommunity(activeCommunity.id, m.userId)}
                    >
                      <Ionicons name="close-circle-outline" size={20} color="#f44336" />
                    </TouchableOpacity>
                  </View>
                ))}
                {members.length === 0 && (
                  <Text style={styles.emptyText}>No members in this community</Text>
                )}

                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Add Users</Text>
                {allUsers
                  .filter((u) => !memberUserIds.has(u.id))
                  .map((u) => (
                    <View key={u.id} style={styles.userCard}>
                      <View style={[styles.memberAvatar, { backgroundColor: '#e0e0e0' }]}>
                        <Text style={[styles.memberAvatarText, { color: '#666' }]}>
                          {u.displayName?.charAt(0)?.toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{u.displayName}</Text>
                        <Text style={styles.memberRole}>@{u.username} - {u.role}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.addBtn}
                        onPress={() => handleAddToCommunity(u.id, activeCommunity.id)}
                      >
                        <Ionicons name="add-circle" size={24} color="#4caf50" />
                      </TouchableOpacity>
                    </View>
                  ))}
                {allUsers.filter((u) => !memberUserIds.has(u.id)).length === 0 && (
                  <Text style={styles.emptyText}>All users are already members</Text>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'reports' && (
          <>
            <Text style={styles.pageTitle}>Completion Reports</Text>
            <Text style={styles.pageSubtitle}>
              {activeCommunity?.name || 'Select a community'} — {completedTasks.length} completed task{completedTasks.length !== 1 ? 's' : ''}
            </Text>

            {completedTasks.length === 0 && (
              <Text style={styles.emptyText}>No completed tasks yet</Text>
            )}

            {completedTasks.map((task) => (
              <View key={task.id} style={styles.reportCard}>
                <Text style={styles.reportTaskTitle}>{task.title}</Text>
                {task.address ? <Text style={styles.reportAddress}>{task.address}</Text> : null}

                {task.completions.map((c) => (
                  <View key={c.id} style={styles.reportCompletion}>
                    <View style={styles.reportRow}>
                      <Text style={styles.reportLabel}>Signed off by</Text>
                      <Text style={styles.reportValue}>{c.employeeSignOffName}</Text>
                    </View>
                    <View style={styles.reportRow}>
                      <Text style={styles.reportLabel}>Date</Text>
                      <Text style={styles.reportValue}>{new Date(c.completedAt).toLocaleString()}</Text>
                    </View>
                    {c.notes ? (
                      <View style={styles.reportRow}>
                        <Text style={styles.reportLabel}>Notes</Text>
                        <Text style={styles.reportValue}>{c.notes}</Text>
                      </View>
                    ) : null}
                    {c.timeSpentMinutes ? (
                      <View style={styles.reportRow}>
                        <Text style={styles.reportLabel}>Time</Text>
                        <Text style={styles.reportValue}>{c.timeSpentMinutes} min</Text>
                      </View>
                    ) : null}
                    {c.materialsUsed ? (
                      <View style={styles.reportRow}>
                        <Text style={styles.reportLabel}>Materials</Text>
                        <Text style={styles.reportValue}>{c.materialsUsed}</Text>
                      </View>
                    ) : null}
                    {c.followUpNeeded ? (
                      <View style={styles.reportRow}>
                        <Text style={styles.reportLabel}>Follow-up</Text>
                        <Text style={styles.reportValue}>{c.followUpNeeded}</Text>
                      </View>
                    ) : null}
                    {c.attachments.length > 0 && (
                      <View style={styles.reportPhotos}>
                        {c.attachments.map((a) => (
                          <Image
                            key={a.id}
                            source={{ uri: `${getApiUrl()}${a.url}` }}
                            style={styles.reportPhoto}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </>
        )}

        {activeTab === 'assets' && (
          <>
            <Text style={styles.pageTitle}>Assets</Text>
            <Text style={styles.pageSubtitle}>{activeCommunity?.name || 'Select a community'}</Text>

            <View style={styles.actionGrid}>
              <TouchableOpacity style={styles.actionCard} onPress={() => setShowCreateAsset(true)}>
                <Ionicons name="add-circle-outline" size={28} color="#25C1AC" />
                <Text style={styles.actionLabel}>Create Asset</Text>
              </TouchableOpacity>
            </View>

            {assets.length === 0 && (
              <Text style={styles.emptyText}>No assets in this community</Text>
            )}

            {assets.map((asset) => (
              <TouchableOpacity
                key={asset.id}
                style={styles.assetCard}
                onPress={() => setShowAssetDetail(asset)}
              >
                <View style={styles.assetCardHeader}>
                  <View style={styles.assetTypeBadge}>
                    <Text style={styles.assetTypeBadgeText}>
                      {ASSET_TYPE_LABELS[asset.assetType] || asset.assetType}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="#ccc" />
                </View>
                <Text style={styles.assetLabel}>{asset.label}</Text>
                {asset.featureRef ? (
                  <Text style={styles.assetMeta}>Ref: {asset.featureRef}</Text>
                ) : null}
                {asset.latitude != null && asset.longitude != null ? (
                  <Text style={styles.assetMeta}>
                    {asset.latitude.toFixed(5)}, {asset.longitude.toFixed(5)}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </>
        )}

        {activeTab === 'layers' && (
          <>
            <Text style={styles.pageTitle}>Map Layers</Text>
            <Text style={styles.pageSubtitle}>{activeCommunity?.name || 'Select a community'}</Text>

            <View style={styles.actionGrid}>
              <TouchableOpacity style={styles.actionCard} onPress={() => setShowCreateLayer(true)}>
                <Ionicons name="add-circle-outline" size={28} color="#25C1AC" />
                <Text style={styles.actionLabel}>Add Layer</Text>
              </TouchableOpacity>
            </View>

            {LAYER_KEYS.map((lk) => {
              const groupLayers = mapLayersList.filter((l) => l.layerKey === lk);
              if (groupLayers.length === 0) return null;
              return (
                <View key={lk} style={{ marginBottom: 16 }}>
                  <Text style={styles.sectionTitle}>{LAYER_KEY_LABELS[lk]}</Text>
                  {groupLayers.map((layer) => (
                    <TouchableOpacity
                      key={layer.id}
                      style={styles.assetCard}
                      onPress={() => { setShowLayerDetail(layer); setReplaceGeoJSON(''); }}
                    >
                      <View style={styles.assetCardHeader}>
                        <View style={styles.assetTypeBadge}>
                          <Text style={styles.assetTypeBadgeText}>{lk}</Text>
                        </View>
                        <TouchableOpacity onPress={() => handleDeleteLayer(layer)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          <Ionicons name="trash-outline" size={16} color="#f44336" />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.assetLabel}>{layer.displayName}</Text>
                      <Text style={styles.assetMeta}>Key: {layer.subLayerKey}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })}

            {mapLayersList.length === 0 && (
              <Text style={styles.emptyText}>No map layers in this community</Text>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showCreateTask} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modalContainer} contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreateTask(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Task</Text>
            <View style={{ width: 60 }} />
          </View>

          <TextInput style={styles.input} placeholder="Task title" placeholderTextColor="#999" value={taskTitle} onChangeText={setTaskTitle} />
          <TextInput style={[styles.input, { minHeight: 80 }]} placeholder="Description" placeholderTextColor="#999" value={taskDescription} onChangeText={setTaskDescription} multiline textAlignVertical="top" />
          <TextInput style={styles.input} placeholder="Address" placeholderTextColor="#999" value={taskAddress} onChangeText={setTaskAddress} />

          <View style={styles.row}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Latitude" placeholderTextColor="#999" value={taskLat} onChangeText={setTaskLat} keyboardType="numeric" />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Longitude" placeholderTextColor="#999" value={taskLng} onChangeText={setTaskLng} keyboardType="numeric" />
          </View>

          <Text style={styles.fieldLabel}>Priority</Text>
          <View style={styles.priorityRow}>
            {priorities.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.priorityChip, taskPriority === p && styles.priorityChipActive]}
                onPress={() => setTaskPriority(p)}
              >
                <Text style={[styles.priorityChipText, taskPriority === p && styles.priorityChipTextActive]}>
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Assign To</Text>
          <FlatList
            data={contractors}
            horizontal
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.assigneeChip, taskAssignee === item.id && styles.assigneeChipActive]}
                onPress={() => setTaskAssignee(taskAssignee === item.id ? '' : item.id)}
              >
                <Text style={[styles.assigneeChipText, taskAssignee === item.id && styles.assigneeChipTextActive]}>
                  {item.displayName}
                </Text>
              </TouchableOpacity>
            )}
            scrollEnabled={!!contractors.length}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          />

          <TouchableOpacity
            style={[styles.submitButton, taskSubmitting && styles.buttonDisabled]}
            onPress={handleCreateTask}
            disabled={taskSubmitting}
          >
            {taskSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create Task</Text>}
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      <Modal visible={showCreateCommunity} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowCreateCommunity(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>New Community</Text>
              <View style={{ width: 60 }} />
            </View>

            <TextInput style={styles.input} placeholder="Community name" placeholderTextColor="#999" value={communityName} onChangeText={setCommunityName} />
            <TextInput style={[styles.input, { minHeight: 80 }]} placeholder="Description" placeholderTextColor="#999" value={communityDesc} onChangeText={setCommunityDesc} multiline textAlignVertical="top" />

            <TouchableOpacity
              style={[styles.submitButton, communitySubmitting && styles.buttonDisabled]}
              onPress={handleCreateCommunity}
              disabled={communitySubmitting}
            >
              {communitySubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create Community</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!showUserDetail} animationType="slide" presentationStyle="pageSheet">
        {showUserDetail && (
          <ScrollView style={styles.modalContainer} contentContainerStyle={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowUserDetail(null)}>
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>User Details</Text>
              <View style={{ width: 60 }} />
            </View>

            <View style={styles.userDetailCard}>
              <View style={[styles.bigAvatar, showUserDetail.role === 'admin' ? { backgroundColor: '#9c27b0' } : { backgroundColor: '#25C1AC' }]}>
                <Text style={styles.bigAvatarText}>
                  {showUserDetail.displayName?.charAt(0)?.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.userDetailName}>{showUserDetail.displayName}</Text>
              <Text style={styles.userDetailUsername}>@{showUserDetail.username}</Text>
              <View style={[styles.roleBadge, showUserDetail.role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeContractor, { marginTop: 8 }]}>
                <Text style={[styles.roleBadgeText, showUserDetail.role === 'admin' ? styles.roleBadgeTextAdmin : styles.roleBadgeTextContractor]}>
                  {showUserDetail.role}
                </Text>
              </View>
            </View>

            {showUserDetail.id !== user?.id && (
              <TouchableOpacity
                style={styles.roleToggleButton}
                onPress={() => handleToggleRole(showUserDetail)}
              >
                <Ionicons name="swap-horizontal" size={18} color="#25C1AC" />
                <Text style={styles.roleToggleText}>
                  Switch to {showUserDetail.role === 'admin' ? 'Contractor' : 'Admin'}
                </Text>
              </TouchableOpacity>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Community Memberships</Text>
            {communities.map((c) => {
              const isMember = members.some(
                (m) => m.userId === showUserDetail.id && activeCommunity?.id === c.id
              );
              return (
                <View key={c.id} style={styles.communityRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{c.name}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.communityToggle, isMember && styles.communityToggleActive]}
                    onPress={() => {
                      if (isMember) {
                        handleRemoveFromCommunity(c.id, showUserDetail.id);
                      } else {
                        handleAddToCommunity(showUserDetail.id, c.id);
                      }
                    }}
                  >
                    <Text style={[styles.communityToggleText, isMember && styles.communityToggleTextActive]}>
                      {isMember ? 'Remove' : 'Add'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}
      </Modal>

      <Modal visible={showCreateAsset} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modalContainer} contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreateAsset(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Asset</Text>
            <View style={{ width: 60 }} />
          </View>

          <Text style={styles.fieldLabel}>Asset Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={styles.priorityRow}>
              {ASSET_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.priorityChip, assetType === t && styles.priorityChipActive]}
                  onPress={() => setAssetType(t)}
                >
                  <Text style={[styles.priorityChipText, assetType === t && styles.priorityChipTextActive]}>
                    {ASSET_TYPE_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <TextInput style={styles.input} placeholder="Label (required)" placeholderTextColor="#999" value={assetLabel} onChangeText={setAssetLabel} />
          <TextInput style={styles.input} placeholder="Feature Reference (optional)" placeholderTextColor="#999" value={assetFeatureRef} onChangeText={setAssetFeatureRef} />

          <Text style={styles.fieldLabel}>Geometry Type</Text>
          <View style={styles.priorityRow}>
            {GEOMETRY_TYPES.map((g) => (
              <TouchableOpacity
                key={g}
                style={[styles.priorityChip, assetGeometryType === g && styles.priorityChipActive]}
                onPress={() => setAssetGeometryType(assetGeometryType === g ? '' : g)}
              >
                <Text style={[styles.priorityChipText, assetGeometryType === g && styles.priorityChipTextActive]}>
                  {g}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Latitude" placeholderTextColor="#999" value={assetLat} onChangeText={setAssetLat} keyboardType="numeric" />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Longitude" placeholderTextColor="#999" value={assetLng} onChangeText={setAssetLng} keyboardType="numeric" />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, assetSubmitting && styles.buttonDisabled]}
            onPress={handleCreateAsset}
            disabled={assetSubmitting}
          >
            {assetSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create Asset</Text>}
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      <Modal visible={!!showAssetDetail} animationType="slide" presentationStyle="pageSheet">
        {showAssetDetail && (
          <ScrollView style={styles.modalContainer} contentContainerStyle={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setShowAssetDetail(null); setNewPropKey(''); setNewPropValue(''); }}>
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Asset Details</Text>
              <View style={{ width: 60 }} />
            </View>

            <View style={styles.userDetailCard}>
              <View style={styles.assetTypeBadge}>
                <Text style={styles.assetTypeBadgeText}>
                  {ASSET_TYPE_LABELS[showAssetDetail.assetType] || showAssetDetail.assetType}
                </Text>
              </View>
              <Text style={[styles.userDetailName, { marginTop: 12 }]}>{showAssetDetail.label}</Text>
              {showAssetDetail.featureRef ? (
                <Text style={styles.userDetailUsername}>Ref: {showAssetDetail.featureRef}</Text>
              ) : null}
              {showAssetDetail.latitude != null && showAssetDetail.longitude != null ? (
                <Text style={styles.userDetailUsername}>
                  {showAssetDetail.latitude.toFixed(5)}, {showAssetDetail.longitude.toFixed(5)}
                </Text>
              ) : null}
            </View>

            <Text style={styles.sectionTitle}>Properties</Text>
            {assetDetail?.properties && assetDetail.properties.length > 0 ? (
              assetDetail.properties.map((prop) => (
                <View key={prop.id} style={styles.assetPropRow}>
                  <Text style={styles.assetPropKey}>{prop.key}</Text>
                  <Text style={styles.assetPropValue}>{prop.value}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No properties yet</Text>
            )}

            <View style={styles.addPropRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Key"
                placeholderTextColor="#999"
                value={newPropKey}
                onChangeText={setNewPropKey}
              />
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Value"
                placeholderTextColor="#999"
                value={newPropValue}
                onChangeText={setNewPropValue}
              />
              <TouchableOpacity onPress={handleAddProperty}>
                <Ionicons name="add-circle" size={32} color="#25C1AC" />
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </Modal>

      <Modal visible={showCreateLayer} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modalContainer} contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreateLayer(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Map Layer</Text>
            <View style={{ width: 60 }} />
          </View>

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.priorityRow}>
            {LAYER_KEYS.map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.priorityChip, layerKey === k && styles.priorityChipActive]}
                onPress={() => setLayerKey(k)}
              >
                <Text style={[styles.priorityChipText, layerKey === k && styles.priorityChipTextActive]}>
                  {LAYER_KEY_LABELS[k]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput style={styles.input} placeholder="Sub-layer key (e.g. zones, main)" placeholderTextColor="#999" value={layerSubKey} onChangeText={setLayerSubKey} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Display name" placeholderTextColor="#999" value={layerDisplayName} onChangeText={setLayerDisplayName} />
          <TextInput
            style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
            placeholder="Paste GeoJSON data (optional, can add later)"
            placeholderTextColor="#999"
            value={layerGeoJSON}
            onChangeText={setLayerGeoJSON}
            multiline
          />

          <TouchableOpacity
            style={[styles.submitButton, layerSubmitting && styles.buttonDisabled]}
            onPress={handleCreateLayer}
            disabled={layerSubmitting}
          >
            {layerSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create Layer</Text>}
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      <Modal visible={!!showLayerDetail} animationType="slide" presentationStyle="pageSheet">
        {showLayerDetail && (
          <ScrollView style={styles.modalContainer} contentContainerStyle={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowLayerDetail(null)}>
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Layer Details</Text>
              <View style={{ width: 60 }} />
            </View>

            <View style={styles.userDetailCard}>
              <View style={styles.assetTypeBadge}>
                <Text style={styles.assetTypeBadgeText}>
                  {LAYER_KEY_LABELS[showLayerDetail.layerKey] || showLayerDetail.layerKey}
                </Text>
              </View>
              <Text style={[styles.userDetailName, { marginTop: 12 }]}>{showLayerDetail.displayName}</Text>
              <Text style={styles.userDetailUsername}>Key: {showLayerDetail.subLayerKey}</Text>
              <Text style={styles.userDetailUsername}>Version: {showLayerDetail.version}</Text>
            </View>

            <Text style={styles.sectionTitle}>Replace GeoJSON Data</Text>
            <TextInput
              style={[styles.input, { minHeight: 150, textAlignVertical: 'top' }]}
              placeholder="Paste GeoJSON FeatureCollection here..."
              placeholderTextColor="#999"
              value={replaceGeoJSON}
              onChangeText={setReplaceGeoJSON}
              multiline
            />

            <TouchableOpacity
              style={[styles.submitButton, replacingGeoJSON && styles.buttonDisabled]}
              onPress={handleReplaceGeoJSON}
              disabled={replacingGeoJSON}
            >
              {replacingGeoJSON ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Update GeoJSON</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: '#f44336', marginTop: 12 }]}
              onPress={() => handleDeleteLayer(showLayerDetail)}
            >
              <Text style={styles.submitText}>Delete Layer</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { padding: 20, paddingBottom: 100 },
  centerContent: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  tabBarWrapper: {
    overflow: 'hidden',
  },
  tabBarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 29, 49, 0.82)',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabActive: { backgroundColor: 'rgba(37, 193, 172, 0.2)' },
  tabText: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
  tabTextActive: { color: '#25C1AC', fontWeight: '600' },
  pageTitle: { fontSize: 24, fontWeight: '700', color: '#0C1D31' },
  pageSubtitle: { fontSize: 14, color: '#888', marginTop: 2, marginBottom: 20 },
  actionGrid: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  actionCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  actionLabel: { fontSize: 12, fontWeight: '600', color: '#444', textAlign: 'center' },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0C1D31', marginBottom: 12 },
  statRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: '700', color: '#25C1AC' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 2 },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#25C1AC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  memberName: { fontSize: 15, fontWeight: '500', color: '#0C1D31' },
  memberRole: { fontSize: 12, color: '#888' },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleBadgeAdmin: { backgroundColor: '#f3e5f5' },
  roleBadgeContractor: { backgroundColor: '#E6F9F6' },
  roleBadgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  roleBadgeTextAdmin: { color: '#9c27b0' },
  roleBadgeTextContractor: { color: '#25C1AC' },
  removeBtn: { padding: 4 },
  addBtn: { padding: 4 },
  emptyText: { fontSize: 14, color: '#999', paddingVertical: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#999' },
  emptySubtitle: { fontSize: 14, color: '#bbb' },
  modalContainer: { flex: 1, backgroundColor: '#f5f7fa' },
  modalContent: { padding: 20, paddingTop: 60 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0C1D31' },
  cancelText: { fontSize: 16, color: '#25C1AC' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#333',
    marginBottom: 12,
  },
  row: { flexDirection: 'row', gap: 12 },
  fieldLabel: { fontSize: 14, fontWeight: '500', color: '#666', marginBottom: 8, marginTop: 4 },
  priorityRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  priorityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  priorityChipActive: { backgroundColor: '#25C1AC' },
  priorityChipText: { fontSize: 13, fontWeight: '500', color: '#666', textTransform: 'capitalize' },
  priorityChipTextActive: { color: '#fff' },
  assigneeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  assigneeChipActive: { backgroundColor: '#25C1AC' },
  assigneeChipText: { fontSize: 13, fontWeight: '500', color: '#666' },
  assigneeChipTextActive: { color: '#fff' },
  submitButton: {
    backgroundColor: '#25C1AC',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  userDetailCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  bigAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  bigAvatarText: { fontSize: 24, fontWeight: '700', color: '#fff' },
  userDetailName: { fontSize: 20, fontWeight: '700', color: '#0C1D31' },
  userDetailUsername: { fontSize: 14, color: '#888', marginTop: 2 },
  roleToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E6F9F6',
    borderRadius: 999,
    padding: 14,
  },
  roleToggleText: { fontSize: 15, fontWeight: '600', color: '#25C1AC' },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  communityToggle: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e8f5e9',
  },
  communityToggleActive: { backgroundColor: '#ffebee' },
  communityToggleText: { fontSize: 13, fontWeight: '600', color: '#4caf50' },
  communityToggleTextActive: { color: '#f44336' },
  reportCard: {
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
  reportTaskTitle: { fontSize: 16, fontWeight: '700', color: '#0C1D31', marginBottom: 4 },
  reportAddress: { fontSize: 13, color: '#888', marginBottom: 8 },
  reportCompletion: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 10,
    marginTop: 8,
  },
  reportRow: { flexDirection: 'row', marginBottom: 4, gap: 8 },
  reportLabel: { fontSize: 13, fontWeight: '600', color: '#555', width: 90 },
  reportValue: { fontSize: 13, color: '#333', flex: 1 },
  reportPhotos: { flexDirection: 'row', gap: 8, marginTop: 8 },
  reportPhoto: { width: 64, height: 64, borderRadius: 8 },
  assetCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  assetCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  assetTypeBadge: {
    backgroundColor: '#E6F9F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  assetTypeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#25C1AC',
  },
  assetLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
    marginBottom: 2,
  },
  assetMeta: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  assetPropRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    gap: 8,
  },
  assetPropKey: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0C1D31',
    minWidth: 80,
  },
  assetPropValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  addPropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
});
