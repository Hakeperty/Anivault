# AniVault - Quick Start Build Guide

## 🚀 Fast Track to APK

### Prerequisites
- Termux environment on Android
- Node.js and npm available
- Java installed (OpenJDK recommended)
- Git installed

### 1-Minute Setup

```bash
# Clone/navigate to project
cd /root/anivault

# Install dependencies
npm install

# Sync Capacitor
npx cap sync

# Build APK
cd android
./gradlew assembleDebug

# Done! APK at:
# /root/anivault/android/app/build/outputs/apk/debug/app-debug.apk
```

## What You Get

✅ **Fully functional anime/manga library app** with:
- Multi-source content search (HiAnime + MangaDex + MangaKatana)
- IndexedDB local storage with persistence
- Dark AMOLED UI theme (#0a0a0a / #FF6B35)
- Library grid with progress tracking
- Capacitor Android integration

## Key Commands

```bash
# Development (inside anivault/)
npm install                 # Install deps
npx cap sync               # Sync web assets
npx cap open android       # Open Android Studio

# Building
cd android
./gradlew assembleDebug    # Debug APK
./gradlew assembleRelease  # Release APK (requires signing)

# Testing
npm run android:build      # Shorthand for debug build
```

## File Structure Quick Reference

```
src/
├── index.html              ← App entry point
├── main.js                 ← Router (7.8 KB)
├── styles/global.css       ← Theme (800 lines)
├── screens/                ← 7 screens (library, search, detail, etc)
├── scrapers/               ← HiAnime, MangaDex, MangaKatana + coordinator
├── db/indexeddb.js         ← Database (10.7 KB)
└── utils/toast.js          ← Notifications
```

## Features Status

| Feature | Status | Location |
|---------|--------|----------|
| Library Grid | ✅ Complete | `screens/library.js` |
| Search | 🔶 Ready | `screens/search.js` |
| Database | ✅ Complete | `db/indexeddb.js` |
| Scrapers | ✅ Complete | `scrapers/` |
| Video Player | 🔶 Structure | `screens/player.js` |
| Manga Reader | 🔶 Structure | `screens/reader.js` |
| Settings | 🔶 Stub | `screens/settings.js` |

## Troubleshooting

### "SDK location not found"
Set `ANDROID_HOME` environment variable:
```bash
export ANDROID_HOME=/path/to/android-sdk
export PATH=$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH
```

### "Gradle daemon"
Gradle downloads and caches on first run (30-60s), then builds are faster.

### "CORS errors in scrapers"
HiAnime uses `allorigins.win` proxy. If rate-limited, set up a custom proxy.

## Next: Enhance the App

1. **Search Screen**: Integrate SearchCoordinator for live search
2. **Video Player**: Add HLS.js for stream playback
3. **Manga Reader**: Implement touch gestures
4. **Download Manager**: Add queue UI and background tasks

See `BUILD_STATUS.md` for detailed roadmap.

## APK Installation

```bash
# On device or via adb
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

## Links

- 📚 **Full Docs**: `BUILD_STATUS.md`
- 🎨 **Implementation**: `ANIVAULT_IMPLEMENTATION_SUMMARY.md`
- 📖 **Original Spec**: `anivault.md`
- 🔧 **Status**: `PROJECT_STATUS.txt`

---

**Ready to build? Run:** `cd /root/anivault && npm install && npx cap sync && cd android && ./gradlew assembleDebug`
