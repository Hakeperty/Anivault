/**
 * AniVault - Main App Entry Point
 * Handles routing between screens and UI updates
 */

import { db } from './db/indexeddb.js';
import { showToast } from './utils/toast.js';
import { LibraryScreen } from './screens/library.js';
import { SearchScreen } from './screens/search.js';
import { DownloadsScreen } from './screens/downloads.js';
import { SettingsScreen } from './screens/settings.js';
import { DetailScreen } from './screens/detail.js';
import { PlayerScreen } from './screens/player.js';
import { ReaderScreen } from './screens/reader.js';
import { AniWatchScraper } from './scrapers/aniwatch.js';

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

            // Load saved API URL from settings
            try {
                const savedApiUrl = await db.getSetting('animeApiUrl');
                if (savedApiUrl) {
                    AniWatchScraper.API_BASE = savedApiUrl;
                    console.log('[API] Using saved anime API:', savedApiUrl);
                }
            } catch (e) {
                console.warn('[API] Failed to load saved API URL:', e.message);
            }

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

            // Load default screen
            await this.loadScreen('library');
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
            const { libraryItem, episode } = e.detail;
            await this.loadPlayerScreen(libraryItem, episode);
        });

        // Handle navigation to reader
        document.addEventListener('navigateToReader', async (e) => {
            const { libraryItem, chapter } = e.detail;
            await this.loadReaderScreen(libraryItem, chapter);
        });

        // Handle back navigation
        document.addEventListener('goBack', () => this.goBack());
    }

    async loadScreen(screenName) {
        const container = document.getElementById('screen-container');
        
        try {
            let screen;

            switch (screenName) {
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

            this.currentScreen = { name: screenName, instance: screen };
            this.history.push(screenName);
        } catch (error) {
            console.error(`Error loading screen ${screenName}:`, error);
            showToast(`Failed to load ${screenName}`, 'error');
        }
    }

    async loadDetailScreen(item, source) {
        const container = document.getElementById('screen-container');
        this.history.push('detail');
        
        try {
            const detailScreen = new DetailScreen(item, source);
            const html = await detailScreen.render();
            container.innerHTML = html;
            await detailScreen.afterRender();
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

    async loadPlayerScreen(libraryItem, episode) {
        const container = document.getElementById('screen-container');
        this.history.push('player');
        
        try {
            const playerScreen = new PlayerScreen(libraryItem, episode);
            const html = await playerScreen.render();
            container.innerHTML = html;
            await playerScreen.afterRender();
            this.currentScreen = { name: 'player', instance: playerScreen };
            
            // Hide bottom nav for fullscreen
            document.getElementById('bottom-nav').style.display = 'none';
        } catch (error) {
            console.error('Error loading player:', error);
            showToast('Failed to load player', 'error');
            this.goBack();
        }
    }

    async loadReaderScreen(libraryItem, chapter) {
        const container = document.getElementById('screen-container');
        this.history.push('reader');
        
        try {
            const readerScreen = new ReaderScreen(libraryItem, chapter);
            const html = await readerScreen.render();
            container.innerHTML = html;
            await readerScreen.afterRender();
            this.currentScreen = { name: 'reader', instance: readerScreen };
            
            // Hide bottom nav for fullscreen
            document.getElementById('bottom-nav').style.display = 'none';
        } catch (error) {
            console.error('Error loading reader:', error);
            showToast('Failed to load reader', 'error');
            this.goBack();
        }
    }

    goBack() {
        this.history.pop();
        const previousScreen = this.history[this.history.length - 1];

        if (previousScreen === 'library' || previousScreen === 'search' || 
            previousScreen === 'downloads' || previousScreen === 'settings') {
            // Show nav again
            document.getElementById('bottom-nav').style.display = 'flex';
            this.loadScreen(previousScreen);
        } else if (this.history.length > 1) {
            this.goBack();
        } else {
            this.loadScreen('library');
        }
    }

    updateNavigation(screenName) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === screenName);
        });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    const app = new AniVaultApp();
    await app.init();
    window.app = app; // Expose for debugging
});
