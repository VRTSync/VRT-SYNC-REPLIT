import React, { useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBarFill from "@/components/StatusBarFill";
import Toast from "@/components/Toast";
import NewCustomerModal from "@/components/NewCustomerModal";
import { useCommunity, type Community } from "@/client/contexts/CommunityContext";

export default function McCustomersScreen() {
  const router = useRouter();
  const { communities, isLoading } = useCommunity();

  const [modalVisible, setModalVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [toastKey, setToastKey] = useState(0);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    setToastType(type);
    setToastKey((k) => k + 1);
    setToastVisible(true);
    toastTimeoutRef.current = setTimeout(() => setToastVisible(false), 4000);
  };

  const handleCardPress = (community: Community) => {
    router.push(`/mc-workspace/${community.id}` as any);
  };

  const renderItem = ({ item }: { item: Community }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => handleCardPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardContent}>
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        {item.description ? (
          <Text style={styles.cardDescription} numberOfLines={1}>{item.description}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#bbb" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBarFill />

      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Customers</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
          testID="new-customer-btn"
        >
          <Ionicons name="add-circle-outline" size={26} color="#25C1AC" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : communities.length === 0 ? (
        <View style={styles.centeredState}>
          <Ionicons name="people-outline" size={56} color="#d1d5db" />
          <Text style={styles.emptyTitle}>No customers yet</Text>
          <Text style={styles.emptySubtitle}>
            Add your first customer to get started building their map.
          </Text>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.8}
            testID="new-customer-cta-btn"
          >
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={styles.ctaBtnText}>+ New Customer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={communities}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      <NewCustomerModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onToast={showToast}
      />

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        toastKey={toastKey}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0C1D31",
  },
  addBtn: {
    padding: 4,
  },
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0C1D31",
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#25C1AC",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    marginTop: 12,
  },
  ctaBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardContent: {
    flex: 1,
    marginRight: 8,
  },
  cardName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0C1D31",
  },
  cardDescription: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 3,
  },
});
