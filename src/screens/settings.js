/**
 * Settings Screen - App preferences and configuration
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';

export class SettingsScreen {
    constructor() {}

    async render() {
        const stats = await db.getLibraryStats();

        return `
            <div class="screen settings-screen">
                <div class="screen-header">
                    <h1>Settings</h1>
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">Library Stats</h3>
                    <div class="settings-stats">
                        <div class="stat-card">
                            <span class="stat-value">${stats.totalItems}</span>
                            <span class="stat-label">Total</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-value">${stats.animeCount}</span>
                            <span class="stat-label">Anime</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-value">${stats.mangaCount}</span>
                            <span class="stat-label">Manga</span>
                        </div>
                    </div>
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">Data</h3>
                    <button class="settings-item" id="clear-data-btn">
                        <div class="settings-item-info">
                            <span class="settings-item-title">Clear All Data</span>
                            <span class="settings-item-desc">Remove library, progress, and downloads</span>
                        </div>
                        <svg class="settings-item-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">Content Sources</h3>
                    <div class="settings-item static">
                        <div class="settings-item-info">
                            <span class="settings-item-title">Anime</span>
                            <span class="settings-item-desc">HiAnime, AniWatch</span>
                        </div>
                    </div>
                    <div class="settings-item static">
                        <div class="settings-item-info">
                            <span class="settings-item-title">Manga</span>
                            <span class="settings-item-desc">MangaDex, MangaKatana</span>
                        </div>
                    </div>
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">About</h3>
                    <div class="settings-item static">
                        <div class="settings-item-info">
                            <span class="settings-item-title">AniVault</span>
                            <span class="settings-item-desc">v1.0.0 — Local anime & manga library</span>
                        </div>
                    </div>
                    <div class="settings-item static">
                        <div class="settings-item-info">
                            <span class="settings-item-title">Storage</span>
                            <span class="settings-item-desc">IndexedDB (on-device)</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        document.getElementById('clear-data-btn')?.addEventListener('click', () => this.confirmClearData());
    }

    confirmClearData() {
        const dialog = document.createElement('div');
        dialog.className = 'delete-dialog';
        dialog.innerHTML = `
            <div class="dialog-content">
                <p>Clear all app data? This cannot be undone.</p>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                    <button class="btn btn-danger" data-action="confirm">Clear Data</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        dialog.querySelector('[data-action="confirm"]').addEventListener('click', async () => {
            try {
                await db.clearAllData();
                showToast('All data cleared', 'success');
                dialog.remove();
                const html = await this.render();
                document.getElementById('screen-container').innerHTML = html;
                await this.afterRender();
            } catch (error) {
                console.error('Clear data error:', error);
                showToast('Failed to clear data', 'error');
            }
        });

        dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.remove());
        dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    }
}
