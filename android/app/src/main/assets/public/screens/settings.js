/**
 * Settings Screen - App preferences and configuration
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';

const APP_VERSION = '1.0.0';

const SETTING_DEFAULTS = {
    videoQuality: 'auto',
    contentType: 'both',
    readerMode: 'page',
    nsfwFilter: 'off'
};

export class SettingsScreen {
    constructor() {
        this.settings = {};
        this.stats = null;
    }

    async render() {
        try {
            this.settings = { ...SETTING_DEFAULTS, ...(await db.getAllSettings()) };
        } catch { this.settings = { ...SETTING_DEFAULTS }; }

        try {
            this.stats = await db.getLibraryStats();
        } catch { this.stats = { totalItems: 0, animeCount: 0, mangaCount: 0, totalSize: 0 }; }

        return `
            <div class="screen settings-screen">
                <div class="screen-header">
                    <h1>Settings</h1>
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">Playback</h3>
                    ${this.renderSelect('videoQuality', 'Video Quality', [
                        { value: 'auto', label: 'Auto' },
                        { value: '720p', label: '720p' },
                        { value: '1080p', label: '1080p' }
                    ])}
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">Content</h3>
                    ${this.renderSelect('contentType', 'Default Content Type', [
                        { value: 'both', label: 'Anime & Manga' },
                        { value: 'anime', label: 'Anime Only' },
                        { value: 'manga', label: 'Manga Only' }
                    ])}
                    ${this.renderSelect('readerMode', 'Manga Reader Mode', [
                        { value: 'page', label: 'Page-by-Page' },
                        { value: 'scroll', label: 'Vertical Scroll' }
                    ])}
                    ${this.renderToggle('nsfwFilter', 'NSFW Filter', 'Block adult content from search results')}
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">Library Stats</h3>
                    <div class="settings-stats">
                        <div class="stat-card">
                            <span class="stat-value">${this.stats.totalItems}</span>
                            <span class="stat-label">Total</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-value">${this.stats.animeCount}</span>
                            <span class="stat-label">Anime</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-value">${this.stats.mangaCount}</span>
                            <span class="stat-label">Manga</span>
                        </div>
                    </div>
                </div>

                <div class="settings-group">
                    <h3 class="settings-group-title">Data</h3>
                    <button class="settings-item" id="settings-clear-library">
                        <div class="settings-item-info">
                            <span class="settings-item-title" style="color:var(--error);">Clear All Data</span>
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

                <div class="settings-group" style="padding-bottom:32px;">
                    <h3 class="settings-group-title">About</h3>
                    <div class="settings-item static">
                        <div class="settings-item-info">
                            <span class="settings-item-title">AniVault</span>
                            <span class="settings-item-desc">v${APP_VERSION} — Your personal anime & manga vault</span>
                        </div>
                    </div>
                    <div class="settings-item static">
                        <div class="settings-item-info">
                            <span class="settings-item-title">Storage</span>
                            <span class="settings-item-desc">IndexedDB (on-device, private)</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderSelect(key, label, options) {
        const current = this.settings[key] || options[0].value;
        return `
            <div class="settings-item static" style="justify-content:space-between;">
                <div class="settings-item-info">
                    <span class="settings-item-title">${label}</span>
                </div>
                <select class="setting-select" data-key="${key}" style="background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px;padding:6px 10px;font-size:13px;">
                    ${options.map(o => `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </div>
        `;
    }

    renderToggle(key, label, description) {
        const isOn = this.settings[key] === 'on';
        return `
            <div class="settings-item static" style="justify-content:space-between;">
                <div class="settings-item-info">
                    <span class="settings-item-title">${label}</span>
                    ${description ? `<span class="settings-item-desc">${description}</span>` : ''}
                </div>
                <button class="setting-toggle" data-key="${key}" data-state="${isOn ? 'on' : 'off'}"
                    style="width:48px;height:28px;border-radius:14px;border:none;cursor:pointer;position:relative;transition:background 0.2s ease;
                    background:${isOn ? 'var(--accent-primary)' : 'var(--bg-tertiary)'};">
                    <span style="position:absolute;top:3px;${isOn ? 'right:3px' : 'left:3px'};width:22px;height:22px;border-radius:50%;background:var(--text-primary);transition:all 0.2s ease;"></span>
                </button>
            </div>
        `;
    }

    async afterRender() {
        document.querySelectorAll('.setting-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                await this.saveSetting(e.target.dataset.key, e.target.value);
            });
        });

        document.querySelectorAll('.setting-toggle').forEach(btn => {
            btn.addEventListener('click', async () => {
                const key = btn.dataset.key;
                const newState = btn.dataset.state === 'on' ? 'off' : 'on';
                await this.saveSetting(key, newState);
                btn.dataset.state = newState;
                btn.style.background = newState === 'on' ? 'var(--accent-primary)' : 'var(--bg-tertiary)';
                const knob = btn.querySelector('span');
                if (knob) {
                    knob.style.left = newState === 'on' ? 'auto' : '3px';
                    knob.style.right = newState === 'on' ? '3px' : 'auto';
                }
            });
        });

        document.getElementById('settings-clear-library')?.addEventListener('click', () => this.showClearConfirmation());
    }

    async saveSetting(key, value) {
        try {
            await db.setSetting(key, value);
            this.settings[key] = value;
            showToast('Setting saved', 'success');
        } catch (err) {
            console.error('Failed to save setting:', err);
            showToast('Failed to save setting', 'error');
        }
    }

    showClearConfirmation() {
        const dialog = document.createElement('div');
        dialog.className = 'delete-dialog';
        dialog.innerHTML = `
            <div class="dialog-content">
                <p>Clear all app data? This will permanently delete your library, progress, and downloads. This cannot be undone.</p>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                    <button class="btn btn-danger" data-action="confirm">Clear Everything</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.remove());
        dialog.querySelector('[data-action="confirm"]').addEventListener('click', async () => {
            try {
                await db.clearAllData();
                showToast('All data cleared', 'success');
                dialog.remove();
                await this.refresh();
            } catch (err) {
                console.error('Failed to clear data:', err);
                showToast('Failed to clear data', 'error');
                dialog.remove();
            }
        });
        dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    }

    async refresh() {
        const container = document.getElementById('screen-container');
        if (container) {
            const html = await this.render();
            container.innerHTML = html;
            await this.afterRender();
        }
    }
}
