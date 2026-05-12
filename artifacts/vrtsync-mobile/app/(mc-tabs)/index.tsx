import React from "react";
import { View, Text, StyleSheet } from "react-native";
import StatusBarFill from "@/components/StatusBarFill";

export default function McCustomersScreen() {
  return (
    <View style={styles.container}>
      <StatusBarFill />
      <Text style={styles.placeholder}>Customer list coming soon — MC2</Text>
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
  placeholder: {
    fontSize: 16,
    color: "#666",
  },
});
