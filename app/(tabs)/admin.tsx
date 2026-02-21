import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Alert, ActivityIndicator, Platform, Modal, FlatList,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';

type Contractor = {
  id: string;
  username: string;
  displayName: string;
  role: string;
};

export default function AdminScreen() {
  const { user } = useAuth();
  const { activeCommunity, communities } = useCommunity();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

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

  const [memberUserId, setMemberUserId] = useState('');

  const { data: contractors = [] } = useQuery<Contractor[]>({
    queryKey: ['/api/contractors'],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: user?.role === 'admin',
  });

  const { data: members = [] } = useQuery<any[]>({
    queryKey: ['/api/communities', `/${activeCommunity?.id}`, '/members'],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!activeCommunity && user?.role === 'admin',
  });

  if (user?.role !== 'admin') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <SymbolView name="lock" size={48} tintColor="#ccc" />
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

  const handleAddMember = async () => {
    if (!memberUserId || !activeCommunity) return;
    try {
      await apiRequest('POST', `/api/communities/${activeCommunity.id}/members`, {
        userId: memberUserId,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/communities', `/${activeCommunity.id}`, '/members'] });
      setShowAddMember(false);
      setMemberUserId('');
      Alert.alert('Success', 'Member added');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add member');
    }
  };

  const priorities: Array<'low' | 'medium' | 'high' | 'urgent'> = ['low', 'medium', 'high', 'urgent'];

  return (
    <ScrollView
      style={[styles.container, Platform.OS === 'web' && { paddingTop: 67 + insets.top }]}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.pageTitle}>Admin Panel</Text>
      <Text style={styles.pageSubtitle}>{activeCommunity?.name || 'Select a community'}</Text>

      <View style={styles.actionGrid}>
        <TouchableOpacity style={styles.actionCard} onPress={() => setShowCreateTask(true)}>
          <SymbolView name="plus.circle" size={28} tintColor="#1a73e8" />
          <Text style={styles.actionLabel}>Create Task</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionCard} onPress={() => setShowCreateCommunity(true)}>
          <SymbolView name="building.2" size={28} tintColor="#4caf50" />
          <Text style={styles.actionLabel}>New Community</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionCard} onPress={() => setShowAddMember(true)}>
          <SymbolView name="person.badge.plus" size={28} tintColor="#ff9800" />
          <Text style={styles.actionLabel}>Add Member</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Community Members ({members.length})</Text>
        {members.map((m: any) => (
          <View key={m.id} style={styles.memberRow}>
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>{m.displayName?.charAt(0)?.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{m.displayName}</Text>
              <Text style={styles.memberRole}>{m.role}</Text>
            </View>
          </View>
        ))}
        {members.length === 0 && (
          <Text style={styles.emptyText}>No members in this community</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contractors ({contractors.length})</Text>
        {contractors.map((c) => (
          <View key={c.id} style={styles.memberRow}>
            <View style={[styles.memberAvatar, { backgroundColor: '#ff9800' }]}>
              <Text style={styles.memberAvatarText}>{c.displayName?.charAt(0)?.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{c.displayName}</Text>
              <Text style={styles.memberRole}>@{c.username} ({c.id.slice(0, 8)}...)</Text>
            </View>
          </View>
        ))}
      </View>

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

      <Modal visible={showAddMember} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowAddMember(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add Member</Text>
              <View style={{ width: 60 }} />
            </View>

            <Text style={styles.fieldLabel}>Select a contractor to add to {activeCommunity?.name}</Text>
            {contractors.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.contractorOption, memberUserId === c.id && styles.contractorOptionActive]}
                onPress={() => setMemberUserId(c.id)}
              >
                <Text style={styles.contractorOptionText}>{c.displayName} (@{c.username})</Text>
                {memberUserId === c.id && <SymbolView name="checkmark" size={16} tintColor="#1a73e8" />}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.submitButton, !memberUserId && styles.buttonDisabled]}
              onPress={handleAddMember}
              disabled={!memberUserId}
            >
              <Text style={styles.submitText}>Add to Community</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { padding: 20, paddingBottom: 100 },
  centerContent: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: '#222' },
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a73e8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  memberName: { fontSize: 15, fontWeight: '500', color: '#222' },
  memberRole: { fontSize: 12, color: '#888' },
  emptyText: { fontSize: 14, color: '#999' },
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
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  cancelText: { fontSize: 16, color: '#1a73e8' },
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
  priorityChipActive: { backgroundColor: '#1a73e8' },
  priorityChipText: { fontSize: 13, fontWeight: '500', color: '#666', textTransform: 'capitalize' },
  priorityChipTextActive: { color: '#fff' },
  assigneeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  assigneeChipActive: { backgroundColor: '#1a73e8' },
  assigneeChipText: { fontSize: 13, fontWeight: '500', color: '#666' },
  assigneeChipTextActive: { color: '#fff' },
  contractorOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  contractorOptionActive: { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  contractorOptionText: { fontSize: 15, color: '#333' },
  submitButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
