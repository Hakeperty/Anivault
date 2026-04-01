# GitHub Actions APK Build Setup

This guide explains how to automatically build AniVault APK using GitHub Actions.

## What's Included

✅ **Automatic APK builds** on every push  
✅ **Debug & Release APKs** generated  
✅ **Artifacts storage** for 30 days  
✅ **GitHub Releases** integration  
✅ **PR comments** with build status  

---

## Setup Instructions

### Step 1: Push to GitHub

First, make sure your repository is on GitHub:

```bash
cd anivault
git remote add origin https://github.com/YOUR_USERNAME/anivault.git
git branch -M main
git push -u origin main
```

### Step 2: Enable GitHub Actions

1. Go to your repository on GitHub
2. Click **Settings** → **Actions** → **General**
3. Enable: "Allow all actions and reusable workflows"
4. Save

### Step 3: Trigger Build

The workflow will automatically run when you:
- ✅ Push to `main` or `develop` branch
- ✅ Create a Pull Request
- ✅ Click "Run workflow" in Actions tab

---

## Getting Your APK

### Method 1: From Actions Artifacts (Every Build)

1. Go to your repository
2. Click **Actions** tab
3. Click on the latest workflow run (✅ Build AniVault APK)
4. Scroll down to **Artifacts**
5. Download:
   - `anivault-debug` - For testing on device
   - `anivault-release` - For app stores (unsigned)

### Method 2: From GitHub Releases (Tagged Builds)

1. Create a tag when you want to release:
```bash
git tag v1.0.0
git push origin v1.0.0
```

2. Go to repository **Releases** page
3. New release will appear with APK files attached

### Method 3: Direct Download Link

After a successful build:
```
https://github.com/YOUR_USERNAME/anivault/actions/runs/RUN_ID/attempts/1
```
(Replace RUN_ID with the workflow run number)

---

## What Each APK Is For

### Debug APK (`app-debug.apk`)
- For testing during development
- Debuggable
- No signature required
- Larger file size (~25MB)
- **How to install**:
  ```bash
  adb install app-debug.apk
  ```

### Release APK (`app-release.apk`)
- For distribution
- **Not signed** (you need to sign it for Play Store)
- Smaller file size
- Optimized

---

## Signing for Play Store

To sign the release APK:

```bash
# Create keystore (one time)
keytool -genkey -v -keystore my-release-key.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias my-key-alias

# Sign APK
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore my-release-key.keystore \
  app-release.apk my-key-alias

# Verify signature
jarsigner -verify -verbose -certs app-release.apk
```

---

## Workflow Details

### Triggers

The workflow runs automatically on:

```yaml
- Push to main or develop branch
- Pull requests to main
- Manual trigger (Actions → Run workflow)
```

### Build Steps

1. ✅ Checkout code
2. ✅ Setup Node.js 20
3. ✅ Setup Java 11
4. ✅ Setup Android SDK (API 30-34, Build-tools 34)
5. ✅ Install npm dependencies
6. ✅ Sync Capacitor
7. ✅ Build debug APK
8. ✅ Build release APK
9. ✅ Upload artifacts
10. ✅ Create release (on tags)

### Build Time

Approximate time: **15-20 minutes**
- First run: ~20 min (downloads SDK)
- Subsequent runs: ~12-15 min (cached)

---

## Customization

### Change build trigger

Edit `.github/workflows/build-apk.yml`:

```yaml
on:
  push:
    branches: [ main ]        # Change branches here
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 0 * * 0'       # Weekly build
```

### Add signing

Add to workflow:

```yaml
- name: Sign release APK
  run: |
    jarsigner -verbose -sigalg SHA256withRSA \
      -keystore ${{ secrets.KEYSTORE_FILE }} \
      -storepass ${{ secrets.KEYSTORE_PASSWORD }} \
      -keypass ${{ secrets.KEY_PASSWORD }} \
      android/app/build/outputs/apk/release/app-release.apk \
      ${{ secrets.KEY_ALIAS }}
```

Then add secrets in Settings → Secrets and Variables → Actions.

### Change artifact retention

```yaml
retention-days: 90    # Store for 90 days instead of 30
```

---

## Troubleshooting

### Build Failed: "Gradle build failed"
- Check build logs in Actions tab
- Ensure all npm packages are installed
- Try: `npm ci` instead of `npm install`

### Build Failed: "SDK not found"
- Workflow automatically installs SDK
- Check internet connection isn't blocking downloads

### APK not downloading
- Check artifact storage limits (GitHub allows 1GB free)
- Check retention period hasn't expired

### Want to rebuild without changes
- Go to Actions tab
- Click on a completed workflow
- Click "Re-run jobs"

---

## Advanced: Manual Build on Local Machine

If you want to build locally instead:

```bash
cd anivault

# Install dependencies
npm install

# Sync Capacitor
npx cap sync

# Build
cd android
./gradlew assembleDebug    # Debug
./gradlew assembleRelease  # Release

# Output
# android/app/build/outputs/apk/debug/app-debug.apk
# android/app/build/outputs/apk/release/app-release.apk
```

---

## Monitoring Builds

### GitHub Actions Dashboard

1. Repository → **Actions** tab
2. See all workflow runs
3. Click run to see detailed logs
4. Check for ✅ (pass) or ❌ (fail)

### Email Notifications

GitHub will email you on:
- Build failure
- Build success (if you enable)

### Status Badge

Add to README.md:

```markdown
[![Build Status](https://github.com/YOUR_USERNAME/anivault/actions/workflows/build-apk.yml/badge.svg)](https://github.com/YOUR_USERNAME/anivault/actions)
```

---

## Next Steps

1. ✅ Push repository to GitHub
2. ✅ Workflow starts automatically
3. ✅ Wait 15-20 minutes for build
4. ✅ Download APK from Actions artifacts
5. ✅ Install on device: `adb install app-debug.apk`

---

## Cost

- ✅ **Free!** GitHub Actions provides free build minutes
- Free tier: 2,000 minutes/month (plenty for weekly builds)
- Unlimited if public repository

---

## Support

For issues:
- Check GitHub Actions logs
- See BUILD_GUIDE.md troubleshooting section
- Check Android Gradle plugin docs

---

**Status**: ✅ Ready to use  
**Setup Time**: 5 minutes  
**Build Time**: 15-20 minutes per build  

Push to GitHub and your first APK will be ready in 20 minutes! 🚀
