import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, View, Image, ImageBackground, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import * as Updates from "expo-updates";
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

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "vrt-sync-rq-cache",
});

function LoadingScreen() {
  return (
    <ImageBackground
      source={require('@/assets/images/topography-texture-rotated.png')}
      style={loadingStyles.background}
      imageStyle={loadingStyles.imageStyle}
      resizeMode="repeat"
    >
      <View style={loadingStyles.overlay} />
      <View style={loadingStyles.content}>
        <Image
          source={require('@/assets/images/vrtsync-logo-vertical.png')}
          style={loadingStyles.logo}
          resizeMode="contain"
        />
      </View>
    </ImageBackground>
  );
}

const loadingStyles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: '#1A6FD6',
  },
  imageStyle: {
    opacity: 0.30,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 60, 150, 0.2)',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 260,
    height: 260,
  },
});

function useBackgroundOTACheck() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (__DEV__) return;

    const checkForUpdate = async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable) return;

        await Updates.fetchUpdateAsync();

        Alert.alert(
          "Update Available",
          "A new version of the app is ready. Restart now to apply it?",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Restart",
              onPress: () => Updates.reloadAsync(),
            },
          ]
        );
      } catch {
      }
    };

    checkForUpdate();
  }, []);
}

function AuthNavigator() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const notificationResponseListener = useRef<Notifications.EventSubscription | null>(null);
  const hasNavigated = useRef(false);

  useBackgroundOTACheck();

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

  if (isLoading) {
    return <LoadingScreen />;
  }

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
  const [cacheRestored, setCacheRestored] = useState(true);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: 1000 * 60 * 60 * 24,
            dehydrateOptions: {
              shouldDehydrateQuery: (query) =>
                query.state.status === "success" &&
                query.queryKey[0] !== "/api/objects/upload",
            },
          }}
          onSuccess={() => setCacheRestored(true)}
          onError={() => setCacheRestored(true)}
        >
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <CommunityProvider>
                  <OfflineProvider>
                    <OfflinePackProvider>
                      {cacheRestored ? <AuthNavigator /> : <LoadingScreen />}
                    </OfflinePackProvider>
                  </OfflineProvider>
                </CommunityProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
