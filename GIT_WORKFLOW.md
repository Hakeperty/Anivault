# AniVault Git Workflow & Contribution Guide

## Repository Structure

```
master branch
├── Initial AniVault project setup (base)
├── Add comprehensive build status report
└── Add quick start build guide
```

## Current Status

- **Branch**: master
- **Commits**: 3
- **Working Tree**: Clean ✅
- **All Changes**: Committed and tracked

## Source Code Organization

### Core Application (`src/`)

#### Router & Navigation
- `main.js` - Central app router, screen manager, event handlers

#### Database Layer
- `db/indexeddb.js` - IndexedDB initialization and all CRUD operations

#### User Interface
- `styles/global.css` - Dark AMOLED theme with component library
- `screens/library.js` - Library grid (PRODUCTION-READY)
- `screens/search.js` - Search interface (structure ready)
- `screens/detail.js` - Detail view (structure ready)
- `screens/player.js` - Video player wrapper (structure ready)
- `screens/reader.js` - Manga reader wrapper (structure ready)
- `screens/downloads.js` - Download manager (structure ready)
- `screens/settings.js` - Settings (structure ready)

#### Content Discovery
- `scrapers/coordinator.js` - Multi-source search orchestration
- `scrapers/hianime.js` - HiAnime anime scraper
- `scrapers/mangadex.js` - MangaDex official API wrapper
- `scrapers/mangakatana.js` - MangaKatana manga scraper

#### Utilities
- `utils/toast.js` - Toast notification system

### Configuration & Build

- `package.json` - npm dependencies (15 packages)
- `capacitor.config.json` - Capacitor configuration
- `vite.config.js` - Vite bundler configuration
- `android/` - Capacitor Android project (Gradle-based)

### Documentation

- `BUILD_STATUS.md` - Comprehensive build guide & architecture
- `QUICKSTART_BUILD.md` - Quick reference for building APK
- `ANIVAULT_IMPLEMENTATION_SUMMARY.md` - Original implementation details
- `PROJECT_STATUS.txt` - Project milestones & statistics
- `anivault.md` - Original project specification
- `README.md` - Main project readme

## Making Changes

### Code Changes

1. **Development**
   ```bash
   cd /root/anivault
   # Make your changes
   # Edit files in src/
   ```

2. **Testing**
   ```bash
   # For web testing (browser):
   # Open src/index.html in browser
   
   # For Android testing:
   cd /root/anivault
   npx cap sync           # Sync changes
   cd android
   ./gradlew assembleDebug  # Build APK
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```

3. **Committing**
   ```bash
   git add <files>
   git commit -m "Brief description of changes
   
   - Bullet point details if needed
   - More information about what changed
   
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
   ```

### Adding New Features

1. **New Screen Component**
   ```javascript
   // Create src/screens/newfeature.js
   export class NewFeatureScreen {
       async render() { /* return HTML */ }
       async afterRender() { /* attach listeners */ }
   }
   
   // Add to main.js loadScreen() method
   // Add button to src/index.html bottom nav
   ```

2. **New Content Scraper**
   ```javascript
   // Create src/scrapers/newsource.js
   export class NewSourceScraper {
       static async search(query) { /* implementation */ }
       static async getEpisodes(url) { /* implementation */ }
   }
   
   // Add to coordinator.js searchAll() method
   ```

3. **Database Schema Changes**
   ```javascript
   // Update src/db/indexeddb.js init() method
   // Add new object store or extend schema
   // Add corresponding CRUD methods
   ```

## Git Best Practices for AniVault

### Branch Strategy
- **master**: Main development branch
- Each feature should be in its own branch (future)

### Commit Messages
Format:
```
Verb + description (present tense)

- List of changes
- Implementation details
- Breaking changes if any

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Examples:
```
Add video player HLS.js integration
- Implement custom player controls
- Add playback speed selector
- Implement subtitle track selection

Fix search coordinator fallback logic
- Ensure MangaKatana fallback triggers on MangaDex timeout
- Add timeout configuration
- Improve error messages

Implement manga reader touch gestures
- Add swipe left/right for page navigation
- Implement pinch-to-zoom support
- Add reading direction toggle
```

### Avoiding Common Issues

1. **Never commit node_modules/** ✓ (Already in .gitignore)
2. **Never commit API keys** ✓ (No credentials in code)
3. **Always test before committing** ✓ (Run app locally)
4. **Keep commits atomic** ✓ (One feature per commit)
5. **Update documentation** ✓ (When adding features)

## Deployment Checklist

Before building APK:
- [ ] All changes committed
- [ ] No console errors
- [ ] Database operations tested
- [ ] Scrapers tested with live content
- [ ] UI responsive on mobile viewport
- [ ] Toast notifications working

Build Process:
```bash
cd /root/anivault
git status              # Ensure clean working tree
npx cap sync           # Sync latest changes
cd android
./gradlew assembleDebug  # Build debug APK
```

## Rollback Instructions

If something breaks:

```bash
# See recent commits
git log --oneline -10

# Revert last commit
git revert HEAD

# Or reset to specific commit (careful!)
git reset --hard COMMIT_SHA

# Force push if needed (use sparingly)
git push origin master --force
```

## Performance Optimization Tips

When making changes:
- Use `Promise.allSettled()` for parallel operations
- Implement debouncing for user inputs
- Lazy-load screen components
- Cache API responses
- Use CSS variables for theming

## Testing Strategy

### Unit Testing (Future)
- Database CRUD operations
- Scraper parsing functions
- Router navigation

### Integration Testing (Future)
- Multi-source search workflow
- Library persistence
- Progress tracking

### Manual Testing (Current)
- Test in browser developer tools
- Test on Android device
- Verify scrapers return valid results

## Resources

- **Capacitor Docs**: https://capacitorjs.com/docs
- **IndexedDB MDN**: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- **HLS.js**: https://github.com/video-dev/hls.js
- **MangaDex API**: https://api.mangadex.org

## Support

For questions about the codebase:
- Review ANIVAULT_IMPLEMENTATION_SUMMARY.md
- Check PROJECT_STATUS.txt for current state
- See BUILD_STATUS.md for architecture details
- Read anivault.md for original specification

---

**Status**: Ready for development and contributions
**Last Updated**: 2026-04-01
