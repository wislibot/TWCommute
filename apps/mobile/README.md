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

See `AGENTS.md` for Expo-specific conventions.
