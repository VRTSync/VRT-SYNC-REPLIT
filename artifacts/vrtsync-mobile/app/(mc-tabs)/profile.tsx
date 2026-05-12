import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import StatusBarFill from "@/components/StatusBarFill";
import { useAuth } from "@/client/contexts/AuthContext";

export default function McProfileScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.content}>
        <Text style={styles.signedInLabel}>Signed in as</Text>
        <Text style={styles.displayName}>{user?.displayName}</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fa",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
    gap: 8,
  },
  signedInLabel: {
    fontSize: 14,
    color: "#999",
  },
  displayName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0C1D31",
    marginBottom: 24,
  },
  logoutButton: {
    backgroundColor: "#f44336",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
  },
  logoutText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});
