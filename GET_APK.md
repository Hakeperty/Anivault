# How to Get Your AniVault APK

## Quick Path to APK 🚀

### Step 1: Push to GitHub (2 minutes)

```bash
cd anivault
git remote add origin https://github.com/YOUR_USERNAME/anivault.git
git branch -M main
git push -u origin main
```

### Step 2: Wait for Build (15-20 minutes)

- Go to **Actions** tab on GitHub
- Watch the build progress
- Look for ✅ green checkmark

### Step 3: Download APK (1 minute)

1. Click the completed workflow (✅ Build AniVault APK)
2. Scroll to **Artifacts** section
3. Download `anivault-debug` (for testing)
4. Download `anivault-release` (for app stores)

### Step 4: Install on Device (2 minutes)

```bash
# Debug APK (for testing)
adb install Downloads/anivault-debug.apk

# Or use Android Studio
# File → Open → Select APK
```

---

## All APK Options

### 1. **Quick Test** (Recommended)
- Use `anivault-debug` APK
- No signing needed
- Install directly: `adb install app-debug.apk`

### 2. **App Store Distribution**
- Use `anivault-release` APK
- Needs signing (see GITHUB_ACTIONS_SETUP.md)
- Submit to Google Play Store

### 3. **GitHub Releases** (For versions)
- Create a tag: `git tag v1.0.0 && git push origin v1.0.0`
- APK automatically attached to release
- Download from Releases page

---

## Installation Methods

### Method 1: Via ADB (Recommended)
```bash
# Connect device (USB debugging enabled)
adb devices                                    # Verify connection
adb install path/to/app-debug.apk             # Install
adb shell am start -n com.anivault.app/.MainActivity  # Launch
```

### Method 2: Direct Download
1. Download APK from artifacts/releases
2. Transfer to phone (USB, email, cloud, etc)
3. Open file manager on phone
4. Tap APK file → Install

### Method 3: Android Studio
1. Open Android Studio
2. File → Open → Select APK
3. Click Install

---

## Troubleshooting

### APK Not Found
- Make sure build completed ✅ (not 🔄 or ❌)
- Refresh Actions page
- Check retention period (30 days default)

### Installation Fails: "Unknown sources"
- Enable: Settings → Install unknown apps → Your file manager → Allow

### Installation Fails: "Parse error"
- APK may be corrupted
- Download again
- Check file size (~25MB for debug)

### Device Not Detected
- Enable USB Debugging: Developer Options → USB Debugging
- Install ADB drivers
- Try: `adb devices`

### Build Failed
- Check Actions logs for errors
- Common issues:
  - SDK download failed → Re-run workflow
  - Gradle out of memory → Increase Java heap
  - No internet → Check connection

---

## Auto-Build Explained

Every time you push to GitHub:

1. **GitHub Actions** picks up the push
2. **Android SDK** automatically installed
3. **Gradle** builds both debug & release APKs
4. **Artifacts** stored for 30 days
5. **Release** created (if tagged)
6. **You get notified**

No manual build needed! 🎉

---

## Getting First APK (5 steps)

```bash
# 1. Setup repository
cd anivault
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/anivault.git
git branch -M main

# 2. Push to GitHub
git push -u origin main

# 3. Wait 20 minutes
# (watch Actions tab for ✅)

# 4. Download from artifacts
# GitHub UI → Actions → Download anivault-debug

# 5. Install on phone
adb install anivault-debug.apk
```

---

## Accessing Your APK

### Location 1: GitHub Actions Artifacts
```
Repository → Actions → [Workflow Run] → Artifacts
```
- **Available for**: 30 days
- **File names**: anivault-debug, anivault-release

### Location 2: GitHub Releases
```
Repository → Releases → [Tag Release]
```
- **Available for**: Forever (until deleted)
- **How to create**: `git tag v1.0 && git push origin v1.0`

### Location 3: Direct Download
```
https://github.com/YOUR_USERNAME/anivault/actions
```
- Click workflow run
- Click Artifacts
- Download ZIP

---

## Tips

✅ **First time?** Use debug APK for testing  
✅ **Multiple builds?** GitHub stores last 30 days  
✅ **Version releases?** Create git tags for permanent storage  
✅ **Sharing?** Create GitHub release, share release page  
✅ **Playing?** Install debug APK with `adb install`  

---

## Next Steps

1. Push to GitHub
2. Wait for build ✅
3. Download APK
4. Install: `adb install app-debug.apk`
5. Open app and test!

---

**Time to APK**: ~25 minutes (from now)  
**Cost**: FREE  
**Effort**: ~5 minutes setup  

Ready to go! 🚀
