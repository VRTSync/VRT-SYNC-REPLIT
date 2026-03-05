import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/client/contexts/AuthContext";
import { CommunityProvider } from "@/client/contexts/CommunityContext";
import { OfflineProvider } from "@/client/contexts/OfflineContext";
import { OfflinePackProvider } from "@/client/contexts/OfflinePackContext";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

SplashScreen.preventAutoHideAsync();

function AuthNavigator() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const notificationResponseListener = useRef<Notifications.EventSubscription | null>(null);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (!segments[0]) return;

    const inAuthGroup = segments[0] === "(auth)";
    const isHoa = user?.role === 'hoa_admin' || user?.role === 'hoa_member';
    const correctStack = isHoa ? "(hoa-tabs)" : "(tabs)";
    const wrongStack = isHoa ? "(tabs)" : "(hoa-tabs)";
    let didRedirect = false;

    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
      didRedirect = true;
    } else if (user && inAuthGroup) {
      router.replace(isHoa ? "/(hoa-tabs)" : "/(tabs)");
      didRedirect = true;
    } else if (user && segments[0] === wrongStack) {
      router.replace(`/${correctStack}` as any);
      didRedirect = true;
    }

    if (!didRedirect && !hasNavigated.current) {
      hasNavigated.current = true;
      SplashScreen.hideAsync();
    } else if (didRedirect && !hasNavigated.current) {
      hasNavigated.current = true;
      setTimeout(() => SplashScreen.hideAsync(), 150);
    }
  }, [user, isLoading, segments]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    notificationResponseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.taskId) {
        router.push(`/task/${data.taskId}` as any);
      }
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && user) {
        const data = response.notification.request.content.data;
        if (data?.taskId) {
          router.push(`/task/${data.taskId}` as any);
        }
      }
    });

    return () => {
      if (notificationResponseListener.current) {
        notificationResponseListener.current.remove();
      }
    };
  }, [user]);

  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(hoa-tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="task" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="request-map" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <CommunityProvider>
                  <OfflineProvider>
                    <OfflinePackProvider>
                      <AuthNavigator />
                    </OfflinePackProvider>
                  </OfflineProvider>
                </CommunityProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
