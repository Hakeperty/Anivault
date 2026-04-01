# AniVault - Complete Build Guide

This guide covers building AniVault for both web and Android platforms.

## Table of Contents
1. [Quick Start (Web)](#quick-start-web)
2. [Requirements](#requirements)
3. [Web Development](#web-development)
4. [Android APK Build](#android-apk-build)
5. [Troubleshooting](#troubleshooting)
6. [Deployment](#deployment)

---

## Quick Start (Web)

### Fastest Way to Run AniVault

```bash
# 1. Navigate to project
cd anivault

# 2. Install dependencies (if not already done)
npm install

# 3. Start development server
cd src
python3 -m http.server 8000
# OR
npx http-server

# 4. Open browser
# Visit: http://localhost:8000
```

**That's it!** The app will load in your browser with full functionality.

---

## Requirements

### For Web Development
- **Node.js** v14+ (with npm)
- **Python 3** (for simple HTTP server) OR
- **http-server** package (alternative)
- Modern web browser (Chrome, Firefox, Safari, Edge)

### For Android APK Build
- **Java Development Kit (JDK)** 11+
- **Android SDK** with:
  - SDK Platform 30+ (API level)
  - Build-Tools 30.0.3 or higher
  - Android Emulator (optional, for testing)
- **Gradle** 8.0+ (included with Capacitor)
- **Node.js** v14+

---

## Web Development

### Option 1: Simple Python Server (Recommended for Quick Testing)

```bash
cd anivault/src
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

### Option 2: Using http-server npm package

```bash
# Install globally (one-time)
npm install -g http-server

# Run from src directory
cd anivault/src
http-server
```

### Option 3: Using Node.js Express (For Production-like Testing)

```bash
cd anivault
npm install express cors
```

Create `server.js`:
```javascript
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'src')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

app.listen(8000, () => {
    console.log('Server running at http://localhost:8000');
});
```

Then:
```bash
node server.js
```

### Development Tips

**Hot Reload** (Auto-refresh on file changes):
```bash
# Install nodemon
npm install -g nodemon

# Use with http-server
nodemon --watch src --exec "cd src && python3 -m http.server 8000"
```

**Browser DevTools**:
- Open DevTools: F12 or Ctrl+Shift+I
- Check Console for app logs
- Use Application tab to inspect IndexedDB
- Network tab to monitor API calls

---

## Android APK Build

### Step 1: Install Android SDK

#### Windows/Mac/Linux (Recommended)
1. Download **Android Studio** from https://developer.android.com/studio
2. Install it completely
3. Launch Android Studio and complete setup wizard
4. SDK will be installed at: `~/Android/Sdk`

#### Linux (Using Package Manager)

Ubuntu/Debian:
```bash
sudo apt-get install android-sdk-platform-tools android-sdk-build-tools
```

#### Termux (Android Device)
```bash
apt install android-sdk-platform-tools android-sdk-build-tools
```

### Step 2: Configure Android Home

**Linux/Mac**:
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH

# Add to ~/.bashrc or ~/.zshrc for persistence
echo 'export ANDROID_HOME=$HOME/Android/Sdk' >> ~/.bashrc
echo 'export PATH=$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH' >> ~/.bashrc
```

**Windows**:
1. Open Environment Variables (Win+X → System → Advanced system settings)
2. Click "Environment Variables"
3. New system variable:
   - Name: `ANDROID_HOME`
   - Value: `C:\Users\[YourUsername]\AppData\Local\Android\Sdk`

### Step 3: Verify Setup

```bash
# Check Java installation
java -version

# Check ANDROID_HOME
echo $ANDROID_HOME

# Check adb (Android Debug Bridge)
adb version
```

### Step 4: Build APK

```bash
cd anivault

# 1. Install dependencies
npm install

# 2. Sync web assets to Android project
npx cap sync

# 3. Build debug APK
cd android
./gradlew assembleDebug

# APK output location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Step 5: Install on Device/Emulator

```bash
# Using adb
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Using Android Studio
# Open the android/ folder in Android Studio and click Run
```

### Building Release APK

```bash
cd anivault/android
./gradlew assembleRelease

# Output: android/app/build/outputs/apk/release/app-release.apk
# (Not recommended for distribution without signing)
```

---

## Troubleshooting

### Issue: "Cannot find module" errors in browser

**Solution**: 
- Verify all files are in `src/` directory
- Check file paths in imports (they're case-sensitive)
- Ensure web server is running from `src/` directory

### Issue: "CORS error" when fetching content

**Solution**:
- HiAnime scraper uses CORS proxy (allorigins.win)
- For testing, try searching for popular anime
- Check browser console for specific error

### Issue: IndexedDB not persisting

**Solution**:
- IndexedDB works in normal browsers and WebViews
- In private/incognito mode, it may be disabled
- Clear browser cache: DevTools → Storage → IndexedDB → Clear

### Issue: "SDK location not found" during build

**Solution**:
```bash
# Create local.properties in android/ directory
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# Verify
cat android/local.properties
```

### Issue: Gradle build timeout

**Solution**:
```bash
# First build downloads many dependencies, be patient
# Use verbose mode to see progress
cd android
./gradlew assembleDebug --info

# Increase timeout if needed
./gradlew assembleDebug --timeout 600000
```

### Issue: Java version incompatibility

**Solution**:
- Ensure Java 11 or higher: `java -version`
- If you have Java 8 or older, upgrade to Java 11+
- On Ubuntu: `sudo apt-get install openjdk-11-jdk`

### Issue: "Execution failed for task" in Gradle

**Solution**:
1. Clean build directory: `./gradlew clean`
2. Sync Capacitor again: `npx cap sync`
3. Try build again: `./gradlew assembleDebug`

---

## Deployment

### Web Deployment (Firebase Hosting Example)

```bash
# 1. Install Firebase CLI
npm install -g firebase-tools

# 2. Login
firebase login

# 3. Initialize project
firebase init

# 4. Deploy
firebase deploy --only hosting
```

### Web Deployment (Netlify)

```bash
# 1. Install Netlify CLI
npm install -g netlify-cli

# 2. Deploy
netlify deploy --prod --dir=src
```

### Android Deployment

#### To Google Play Store
1. [Sign APK](https://developer.android.com/studio/publish/app-signing)
2. Create Google Play developer account
3. Upload signed APK to Play Console

#### Direct Distribution (APK Download)
1. Upload APK to cloud storage (GitHub, DropBox, etc.)
2. Share download link
3. Users download and install manually

#### To GitHub Releases

```bash
# 1. Build APK
cd anivault/android
./gradlew assembleDebug

# 2. Tag release
git tag v1.0.0
git push origin v1.0.0

# 3. Upload APK to GitHub Release
# Go to Releases page → Create Release → Upload APK file
```

---

## Performance Tips

### Web
- Cache content with Service Worker
- Lazy load images with IntersectionObserver
- Use IndexedDB for offline data

### Android
- Smaller APK: Run `./gradlew assembleDebug --no-build-cache`
- Faster builds: Keep gradle daemon running
- Test on emulator first, then device

---

## Project Structure

```
anivault/
├── src/                        # Web application
│   ├── index.html             # Main HTML
│   ├── main.js                # App entry point
│   ├── styles/
│   │   └── global.css         # Theme & styling
│   ├── screens/               # Screen components
│   ├── scrapers/              # Content fetchers
│   ├── db/
│   │   └── indexeddb.js       # Database layer
│   └── utils/                 # Helper functions
├── android/                    # Capacitor Android project
│   ├── app/
│   │   ├── src/
│   │   │   └── main/
│   │   │       └── assets/    # Web files bundled here
│   │   └── build.gradle
│   └── gradlew
├── package.json
├── capacitor.config.json
└── vite.config.js
```

---

## Development Workflow

### For Web Development
```
1. Edit files in src/
2. Browser auto-refreshes (if using nodemon)
3. Check DevTools Console for errors
4. Test in different browsers
```

### For Android Development
```
1. Make code changes
2. npx cap sync          # Copy to Android
3. ./gradlew assembleDebug
4. adb install APK
5. Test on device
```

---

## Support & Resources

- **Capacitor Docs**: https://capacitorjs.com
- **IndexedDB Guide**: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- **Android Studio**: https://developer.android.com/studio
- **Gradle Docs**: https://gradle.org/docs/
- **Node.js**: https://nodejs.org/

---

**Last Updated**: April 1, 2026  
**Status**: ✅ Ready for Development and Deployment
