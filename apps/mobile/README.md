# @twc/mobile

Expo SDK 57 app. Routes live in `src/app/` (Expo Router); pure logic lives in `src/lib/` and is unit-tested with Vitest.

```bash
pnpm --filter @twc/mobile typecheck
pnpm --filter @twc/mobile test
EXPO_PUBLIC_API_URL=http://<host>:3000 npx expo run:android
```

| Variable | Default | |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` | Android emulator: `http://10.0.2.2:3000` |
| `EXPO_PUBLIC_MAP_STYLE_URL` | OpenFreeMap Liberty | Any MapLibre style URL |

## Building the APK

- **Windows:** `powershell -ExecutionPolicy Bypass -File apps\mobile\scripts\build-apk.ps1` writes `TWCommute-<version>.apk` at the repository root. It works around Windows' 260-character path limit; its header explains release signing (`TWC_KEYSTORE`, `TWC_KEY_ALIAS`, `TWC_KEYSTORE_PASS`).
- **Linux / macOS:** `npx expo prebuild -p android`, then `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`.
- **In the cloud:** `npx eas-cli@latest build -p android --profile preview` (free Expo account; EAS keeps the release key).

The default APK is signed with the debug key, fine for installing directly. Android won't install an update signed with a different key: uninstall the debug-signed app before installing a release-signed one.

See `AGENTS.md` for Expo-specific conventions.
