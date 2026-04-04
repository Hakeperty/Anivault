/**
 * AniVault - Main App Entry Point
 * Handles routing between screens and UI updates
 */

import { db } from './db/indexeddb.js';
import { showToast } from './utils/toast.js';
import { DownloadManager } from './utils/downloader.js';
import { LibraryScreen } from './screens/library.js';
import { SearchScreen } from './screens/search.js';
import { DownloadsScreen } from './screens/downloads.js';
import { SettingsScreen } from './screens/settings.js';
import { DiscoverScreen } from './screens/discover.js';
import { DetailScreen } from './screens/detail.js';
import { PlayerScreen } from './screens/player.js';
import { ReaderScreen } from './screens/reader.js';

class AniVaultApp {
    constructor() {
        this.currentScreen = null;
        this.screenInstances = {};
        this.history = [];
    }

    async init() {
        try {
            // Initialize database
            await db.init();
            console.log('[DB] initialized');

            // Initialize Capacitor back button if plugin available
            try {
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
                    window.Capacitor.Plugins.App.addListener('backButton', () => this.goBack());
                }
            } catch (e) {
                console.warn('[Capacitor] Back button handler not available:', e.message);
            }

            // Setup UI listeners
            this.setupNavigationListeners();
            this.setupDetailNavigation();

            // Load default screen (Discover is home)
            await this.loadScreen('discover');

            // Start download manager
            DownloadManager.start();
        } catch (error) {
            console.error('App initialization error:', error);
            showToast('Failed to initialize app', 'error');
        }
    }

    setupNavigationListeners() {
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const screen = btn.dataset.screen;
                await this.loadScreen(screen);
                this.updateNavigation(screen);
            });
        });
    }

    setupDetailNavigation() {
        // Handle navigation to detail screen
        document.addEventListener('navigateToDetail', async (e) => {
            const { item, source } = e.detail;
            await this.loadDetailScreen(item, source);
        });

        // Handle navigation to player
        document.addEventListener('navigateToPlayer', async (e) => {
            const { libraryItem, episode, allEpisodes } = e.detail;
            await this.loadPlayerScreen(libraryItem, episode, allEpisodes || []);
        });

        // Handle navigation to reader
        document.addEventListener('navigateToReader', async (e) => {
            const { libraryItem, chapter, allChapters } = e.detail;
            await this.loadReaderScreen(libraryItem, chapter, allChapters || []);
        });

        // Handle back navigation
        document.addEventListener('goBack', () => this.goBack());

        // Download count badge
        document.addEventListener('downloadCountChanged', (e) => {
            const badge = document.getElementById('dl-badge');
            if (badge) {
                const count = e.detail?.active || 0;
                badge.textContent = count > 0 ? String(count) : '';
                badge.classList.toggle('visible', count > 0);
            }
        });
    }

    async loadScreen(screenName) {
        const container = document.getElementById('screen-container');
        
        // Deactivate previous screen if it has a deactivate method
        if (this.currentScreen?.instance?.deactivate) {
            try { this.currentScreen.instance.deactivate(); } catch (e) {}
        }

        try {
            let screen;

            switch (screenName) {
                case 'discover':
                    if (!this.screenInstances.discover) {
                        this.screenInstances.discover = new DiscoverScreen();
                    }
                    screen = this.screenInstances.discover;
                    break;

                case 'library':
                    if (!this.screenInstances.library) {
                        this.screenInstances.library = new LibraryScreen();
                    }
                    screen = this.screenInstances.library;
                    break;

                case 'search':
                    if (!this.screenInstances.search) {
                        this.screenInstances.search = new SearchScreen();
                    }
                    screen = this.screenInstances.search;
                    break;

                case 'downloads':
                    if (!this.screenInstances.downloads) {
                        this.screenInstances.downloads = new DownloadsScreen();
                    }
                    screen = this.screenInstances.downloads;
                    break;

                case 'settings':
                    if (!this.screenInstances.settings) {
                        this.screenInstances.settings = new SettingsScreen();
                    }
                    screen = this.screenInstances.settings;
                    break;

                default:
                    return;
            }

            const html = await screen.render();
            container.innerHTML = html;
            await screen.afterRender();
            this._observeImages(container);

            this.currentScreen = { name: screenName, instance: screen };
            this.history.push(screenName);
            this.updateNavigation(screenName);
        } catch (error) {
            console.error(`Error loading screen ${screenName}:`, error);
            showToast(`Failed to load ${screenName}`, 'error');
        }
    }

    async loadDetailScreen(item, source) {
        const container = document.getElementById('screen-container');
        if (this.currentScreen?.instance?.deactivate) {
            try { this.currentScreen.instance.deactivate(); } catch (e) {}
        }
        this.history.push('detail');
        
        try {
            const detailScreen = new DetailScreen(item, source);
            const html = await detailScreen.render();
            container.innerHTML = html;
            await detailScreen.afterRender();
            this._observeImages(container);
            this.currentScreen = { name: 'detail', instance: detailScreen };
            
            // Update nav
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.remove('active');
            });
        } catch (error) {
            console.error('Error loading detail screen:', error);
            showToast('Failed to load item details', 'error');
            this.goBack();
        }
    }

    async loadPlayerScreen(libraryItem, episode, allEpisodes = []) {
        const container = document.getElementById('screen-container');
        if (this.currentScreen?.instance?.deactivate) {
            try { this.currentScreen.instance.deactivate(); } catch (e) {}
        }
        this.history.push('player');
        
        try {
            const playerScreen = new PlayerScreen(libraryItem, episode, allEpisodes);
            const html = await playerScreen.render();
            container.innerHTML = html;
            await playerScreen.afterRender();
            this.currentScreen = { name: 'player', instance: playerScreen };
            
            // Hide bottom nav and remove safe-area padding for fullscreen
            document.getElementById('bottom-nav').style.display = 'none';
            document.getElementById('screen-container').classList.add('fullscreen-mode');
        } catch (error) {
            console.error('Error loading player:', error);
            showToast('Failed to load player', 'error');
            this.goBack();
        }
    }

    async loadReaderScreen(libraryItem, chapter, allChapters = []) {
        const container = document.getElementById('screen-container');
        if (this.currentScreen?.instance?.deactivate) {
            try { this.currentScreen.instance.deactivate(); } catch (e) {}
        }
        this.history.push('reader');
        
        try {
            const readerScreen = new ReaderScreen(libraryItem, chapter, allChapters);
            const html = await readerScreen.render();
            container.innerHTML = html;
            await readerScreen.afterRender();
            this.currentScreen = { name: 'reader', instance: readerScreen };
            
            // Hide bottom nav and remove safe-area padding for fullscreen
            document.getElementById('bottom-nav').style.display = 'none';
            document.getElementById('screen-container').classList.add('fullscreen-mode');
        } catch (error) {
            console.error('Error loading reader:', error);
            showToast('Failed to load reader', 'error');
            this.goBack();
        }
    }

    goBack() {
        this.history.pop();
        const previousScreen = this.history[this.history.length - 1];

        document.getElementById('screen-container').classList.remove('fullscreen-mode');

        if (previousScreen === 'discover' || previousScreen === 'library' || previousScreen === 'search' || 
            previousScreen === 'downloads' || previousScreen === 'settings') {
            document.getElementById('bottom-nav').style.display = 'flex';
            this.loadScreen(previousScreen);
        } else if (this.history.length > 1) {
            this.goBack();
        } else {
            document.getElementById('bottom-nav').style.display = 'flex';
            this.loadScreen('discover');
        }
    }

    updateNavigation(screenName) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === screenName);
        });
    }

    /** Fade-in images as they load inside a container */
    _observeImages(container) {
        if (!container) return;
        const process = (img) => {
            if (img.complete && img.naturalWidth > 0) {
                img.classList.add('loaded');
            } else {
                img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
                img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
            }
        };
        container.querySelectorAll('img').forEach(process);

        // Watch for dynamically added images (e.g. search results)
        if (this._imgObserver) this._imgObserver.disconnect();
        this._imgObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'IMG') process(node);
                    else node.querySelectorAll?.('img')?.forEach(process);
                }
            }
        });
        this._imgObserver.observe(container, { childList: true, subtree: true });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    const app = new AniVaultApp();
    await app.init();
    window.app = app; // Expose for debugging
});
