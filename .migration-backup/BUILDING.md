# Building VRTSync Mobile for the App Store

This guide covers how to build VRTSync Mobile for iOS and submit it to Apple's App Store using EAS Build.

## Prerequisites

- [Node.js](https://nodejs.org/) and npm installed locally
- An [Expo account](https://expo.dev/signup)
- An [Apple Developer account](https://developer.apple.com/) (paid, $99/year)
- The app registered in [App Store Connect](https://appstoreconnect.apple.com/)

## Step 1: Install EAS CLI

```bash
npm install -g eas-cli
```

## Step 2: Log in to Expo

```bash
eas login
```

## Step 3: Configure `eas.json`

Before building for production, update the placeholders in `eas.json`:

- `EXPO_PUBLIC_DOMAIN` — Set this to your deployed backend domain (e.g., `vrtsync.replit.app`)
- `appleId` — Your Apple ID email address
- `ascAppId` — Your App Store Connect app numeric ID (found in App Store Connect > App Information)
- `appleTeamId` — Your 10-character Apple Team ID (found at developer.apple.com > Membership)

## Step 4: Link the project to EAS

Run this once from the project root to associate the project with your Expo account:

```bash
eas build:configure
```

## Step 5: Build for production

```bash
eas build --platform ios --profile production
```

This will:
- Increment the build number automatically (`autoIncrement: true`)
- Sign the app with your Apple distribution certificate and provisioning profile
- Upload the `.ipa` to Expo's build servers and return a download link

EAS will prompt for Apple credentials on the first run. It will create or reuse certificates and provisioning profiles automatically.

## Step 6: Submit to the App Store

```bash
eas submit --platform ios
```

This uploads the built `.ipa` to App Store Connect and submits it for review. You will need to complete the app metadata (description, screenshots, pricing) in App Store Connect before Apple will approve the submission.

## Build Profiles Summary

| Profile     | Purpose                                                    | Distribution      |
|-------------|------------------------------------------------------------|-------------------|
| development | Testing with Expo Dev Client (native build, not Expo Go)   | Internal (ad hoc) |
| preview     | Internal QA before release (release config, no dev tools)  | Internal (ad hoc) |
| production  | App Store submission                                       | App Store         |

> **Note:** The `development` profile requires Expo Dev Client — a custom native build that supports over-the-air JavaScript updates during development. It is not compatible with the standard Expo Go app. Install the dev client on your device before testing with this profile: `eas build --platform ios --profile development`.

## Environment Variables

The following environment variable is required at build time:

| Variable              | Description                                              |
|-----------------------|----------------------------------------------------------|
| `EXPO_PUBLIC_DOMAIN`  | The hostname of the deployed Express backend (no protocol or trailing slash), e.g. `vrtsync.replit.app` |

Set this in the `env` block of the `production` profile in `eas.json`, or configure it as an EAS secret:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_DOMAIN --value your-domain.replit.app
```

## Notes

- Push notifications require an APNs key configured in App Store Connect and registered with your Expo project. See the [Expo Push Notifications guide](https://docs.expo.dev/push-notifications/push-notifications-setup/).
- The `aps-environment: production` entitlement is already configured in `app.config.js` for production builds.
- Android (Play Store) submission is outside the scope of this setup — see the EAS documentation for Android build profiles.
