const domain = process.env.EXPO_PUBLIC_DOMAIN;

if (!domain) {
  const isLocalDev =
    process.env.NODE_ENV === "development" ||
    process.env.REPLIT_DEV_DOMAIN !== undefined;
  if (!isLocalDev) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is required for non-development builds. " +
        "Set it in your eas.json env block or as an EAS secret."
    );
  }
}

const origin = domain ? `https://${domain}` : "https://localhost:8081";

export default {
  expo: {
    name: "VRTSync Mobile",
    slug: "vrtsyncmobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "vrtsyncmobile",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0C1D31",
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.vrtsyncmobile.app",
      buildNumber: "1",
      infoPlist: {
        NSCameraUsageDescription:
          "VRTSync uses your camera to take photos of site conditions and attach them to maintenance requests.",
        NSPhotoLibraryUsageDescription:
          "VRTSync accesses your photo library so you can attach existing photos to maintenance requests.",
        NSPhotoLibraryAddUsageDescription:
          "VRTSync may save photos to your library when you capture site images.",
        NSLocationWhenInUseUsageDescription:
          "VRTSync uses your location to show your position on the community map and help you navigate to assets.",
      },
      entitlements: {
        "aps-environment": "production",
      },
    },
    android: {
      package: "com.vrtsyncmobile.app",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
    },
    web: {
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      [
        "expo-router",
        {
          origin,
        },
      ],
      "expo-font",
      "expo-web-browser",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
