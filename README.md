# AniVault 📱

**Local Anime & Manga Library App for Android**

A fully-functional anime and manga discovery, streaming, and reading app built with Capacitor.js, vanilla JavaScript, and IndexedDB. Search across multiple sources, stream anime, read manga, track your progress, and build your personal library—all stored locally on your device.

![Status](https://img.shields.io/badge/status-production--ready-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Build](https://img.shields.io/badge/build-GitHub%20Actions-blue?style=flat-square)

---

## ✨ Features

### 📺 Discover & Browse
- **Weekly Airing Schedule** — Tabbed Mon–Sun view showing what anime airs each day (JST), with broadcast times and auto-highlighted today
- **This Season / Top Airing / Most Popular** — Curated sections powered by Jikan (MAL) API
- **Popular & Recently Updated Manga** — MangaDex-powered manga discovery
- **Personalized Recommendations** — Genre-based suggestions from your library history
- **User Recommends** — Community-style recommendation board stored locally
- **Scroll-to-Top** — Floating button for quick navigation

### 🔍 Multi-Source Search
Search across **4 anime and manga sources simultaneously**:
- **Jikan (MyAnimeList)** — Anime metadata, details, schedule, recommendations
- **AniWatch** — Anime episodes & streaming (HLS)
- **MangaDex** — Manga chapters & pages (official REST API)
- **MangaKatana** — Manga chapters & pages (HTML scraping)

### 📖 Smart Cross-Source Fallback
- When MangaDex pages fail for a chapter, automatically searches MangaKatana by title and chapter number (and vice versa)
- Unicode NFKD-normalized title matching with word-overlap scoring prevents wrong-manga matches
- Returns nothing rather than serving the wrong content

### 📚 Library Management
- **Grid Display** — 2-column responsive layout
- **Progress Tracking** — Episode/chapter indicators and percentage bars
- **Continue Watching/Reading** — Quick-access carousel on Discover
- **Smart Search** — Filter within your library
- **Delete & Manage** — Long-press to remove titles

### 🎬 Anime Streaming
- **HLS.js Integration** — Adaptive quality video playback
- **Custom Controls** — Play/pause, seek, fullscreen, speed
- **Audio Toggle** — Switch between sub/dub when available
- **Episode Navigation** — Previous/next episode buttons
- **Progress Auto-Save** — Resumes where you left off

### 📖 Manga Reader
- **Three Reading Modes** — Vertical scroll, page-by-page (LTR/RTL)
- **Touch Gestures** — Tap left/right to turn pages, pinch to zoom
- **Persistent Mode** — Reader remembers your preferred mode
- **Chapter Navigation** — Previous/next chapter buttons

### 💾 Local Storage
- **IndexedDB v2** — 5 stores: Library, Progress, Downloads, Settings, UserRecommends
- **Persistent** — Data survives app restarts
- **Private** — Everything stored locally on your device
- **Fast** — Efficient queries (<100ms for library display)

### 🌙 Dark AMOLED Theme
- **Battery Optimized** — Pure black background (#0a0a0a)
- **Gradient Accents** — Vibrant section-specific highlights
- **Responsive Design** — Works on all screen sizes
- **Touch Optimized** — Large buttons and spacing for mobile

---

## 🚀 Quick Start

### Install from APK (easiest)

Push to `main` triggers a GitHub Actions CI build. Download the latest `anivault-debug` artifact from the [Actions tab](../../actions).

### Build Locally

```bash
# Clone
git clone https://github.com/Hakeperty/Anivault.git
cd Anivault

# Install dependencies
npm install

# Sync Capacitor
npx cap sync

# Build APK (requires Android SDK on x86_64)
cd android && ./gradlew assembleDebug

# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 📁 Project Structure

```
Anivault/
├── src/
│   ├── index.html               ← App entry point
│   ├── main.js                  ← Router & navigation
│   ├── styles/
│   │   └── global.css           ← Dark AMOLED theme (~2000 lines)
│   ├── screens/
│   │   ├── discover.js          ← Home: schedule, trending, recommendations
│   │   ├── library.js           ← Personal library grid
│   │   ├── search.js            ← Multi-source search UI
│   │   ├── detail.js            ← Anime/manga detail + episode/chapter list
│   │   ├── player.js            ← HLS video player
│   │   ├── reader.js            ← Manga reader (3 modes)
│   │   ├── downloads.js         ← Download queue
│   │   └── settings.js          ← App settings
│   ├── scrapers/
│   │   ├── coordinator.js       ← Multi-source orchestration & fallback
│   │   ├── jikan.js             ← MyAnimeList API (search, schedule, recs)
│   │   ├── aniwatch.js          ← Anime episodes & streaming
│   │   ├── mangadex.js          ← MangaDex API (chapters, pages)
│   │   └── mangakatana.js       ← MangaKatana scraper (chapters, pages)
│   ├── db/
│   │   └── indexeddb.js         ← IndexedDB v2 database layer
│   └── utils/
│       ├── http.js              ← HTTP/fetch wrapper
│       └── toast.js             ← Toast notifications
├── android/                     ← Capacitor Android shell
├── .github/workflows/           ← CI: auto-build on push
├── package.json
├── capacitor.config.json
└── vite.config.js
```

---

## 🔌 API & Architecture

### Scraper Coordinator
```javascript
import { SearchCoordinator } from './src/scrapers/coordinator.js';

// Search all sources (anime + manga)
const results = await SearchCoordinator.searchAll('Demon Slayer');

// Trending data (anime sections + manga + weekly schedule)
const trending = await SearchCoordinator.getTrending();

// Episodes with smart title matching
const episodes = await SearchCoordinator.getAnimeEpisodes(id, url, source, title, expectedEps);

// Chapters with cross-source fallback
const chapters = await SearchCoordinator.getMangaChapters(id, source, url, title);

// Pages with automatic fallback to alternate source
const pages = await SearchCoordinator.getChapterPages(chapterId, source, title, chapterNumber);
```

### Database
```javascript
import { db } from './src/db/indexeddb.js';

await db.addToLibrary(item);
const library = await db.getLibrary();
await db.saveProgress(id, episodeNum, chapterNum);
await db.addRecommendation(item);       // User Recommends
const recs = await db.getRecommendations();
```

---

## 🌐 Content Sources

### Anime
| Source | Type | Role | Features |
|--------|------|------|----------|
| Jikan (MAL) | REST API | Metadata, search, schedule | Details, genres, scores, airing schedule, recommendations |
| AniWatch | Scraping | Streaming | Episode lists, HLS streams, sub/dub |

### Manga
| Source | Type | Role | Features |
|--------|------|------|----------|
| MangaDex | REST API | Primary | Chapters, pages, search, metadata |
| MangaKatana | Scraping | Fallback | Chapters, pages, search |

Cross-source fallback: if one manga source fails to return pages, the coordinator automatically searches the other source by title + chapter number with fuzzy matching.

---

## 🔄 CI/CD

GitHub Actions workflow builds a debug APK on every push to `main`:

```yaml
# .github/workflows/android-build.yml
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
      - uses: actions/setup-node@v4
      - run: npm ci && npx cap sync
      - run: cd android && ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
```

Download the `anivault-debug` artifact from the latest passing run.

---

## 🎯 Features Status

### ✅ Complete
- [x] App Router & Navigation
- [x] Discover Screen (schedule, trending, recommendations)
- [x] Weekly Airing Schedule (Jikan, tabbed by day)
- [x] User Recommends board
- [x] Multi-Source Search
- [x] Detail Screen (episodes, chapters, add to library)
- [x] Video Player (HLS.js streaming, sub/dub)
- [x] Manga Reader (vertical scroll, page-by-page LTR/RTL)
- [x] Library Management (grid, search, progress, delete)
- [x] Continue Watching/Reading carousel
- [x] IndexedDB v2 Database Layer
- [x] Smart Cross-Source Manga Fallback
- [x] Dark AMOLED Theme
- [x] Toast Notifications
- [x] Scroll-to-Top button
- [x] GitHub Actions CI

### 🔶 Planned
- [ ] Offline download manager (background fetch)
- [ ] Service Worker for content caching
- [ ] Notification alerts for new episodes
- [ ] Settings screen (quality, theme, etc.)

---

## 🐛 Troubleshooting

### "SDK location not found"
```bash
export ANDROID_HOME=/path/to/android-sdk
export PATH=$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH
```

### Local build fails on ARM64 (Termux/proot)
Android SDK tools are x86_64 only. Use the GitHub Actions CI workflow instead—push to `main` and download the artifact.

### "No results from search"
Some sources may be temporarily down. The coordinator uses `Promise.allSettled` so partial results still display. Try refreshing.

---

## 🎓 Tech Stack

- **Frontend**: Vanilla JavaScript ES6+, HTML5, CSS3
- **Database**: IndexedDB v2
- **Mobile**: Capacitor.js v5.6.0
- **Video**: HLS.js
- **Build**: Gradle (Android), GitHub Actions (CI)
- **APIs**: Jikan v4, MangaDex v5, AniWatch, MangaKatana

---

## 📄 License

MIT License — feel free to use, modify, and distribute.

---

**Status**: ✅
**Last Updated**: 2026-04-04
**Build**: GitHub Actions (auto on push)

Built with ❤️ for anime and manga fans
And tested by Hugo.
