/**
 * Library Screen - Shows user's library of anime/manga
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';

export class LibraryScreen {
    constructor() {
        this.library = [];
        this.continueWatching = [];
    }

    async render() {
        this.library = await db.getLibrary();
        this.continueWatching = this.library
            .filter(item => item.progress && (item.progress.currentEpisode || item.progress.currentChapter))
            .sort((a, b) => new Date(b.progress.lastUpdated) - new Date(a.progress.lastUpdated))
            .slice(0, 10);

        return `
            <div class="screen library-screen">
                <div class="screen-header">
                    <h1>Library</h1>
                    <span class="library-count">${this.library.length} items</span>
                </div>

                ${this.continueWatching.length > 0 ? `
                    <div class="section">
                        <h2>Continue Watching/Reading</h2>
                        <div class="horizontal-scroll">
                            <div class="continue-row">
                                ${this.continueWatching.map(item => `
                                    <div class="continue-item" data-id="${item.id}">
                                        <div class="cover-wrapper">
                                            <img src="${item.coverImage}" alt="${item.title}" class="cover">
                                            <div class="progress-bar">
                                                <div class="progress" style="width: ${this.getProgressPercent(item)}%"></div>
                                            </div>
                                        </div>
                                        <p class="title">${item.title}</p>
                                        <p class="episode-text">
                                            ${item.type === 'anime' ? 
                                                `Ep ${item.progress.currentEpisode}/${item.episodes || '?'}` :
                                                `Ch ${item.progress.currentChapter}/${item.chapters || '?'}`
                                            }
                                        </p>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                ` : ''}

                <div class="section">
                    <h2>Your Library</h2>
                    ${this.library.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-icon">📚</div>
                            <p>Your library is empty</p>
                            <p class="empty-hint">Search for anime or manga to add to your library</p>
                        </div>
                    ` : `
                        <div class="library-grid">
                            ${this.library.map(item => `
                                <div class="library-item" data-id="${item.id}">
                                    <div class="cover-wrapper">
                                        <img src="${item.coverImage}" alt="${item.title}" class="cover">
                                        ${item.progress ? `
                                            <div class="progress-badge">${item.type === 'anime' ? 
                                                (item.progress.currentEpisode || 0) : 
                                                (item.progress.currentChapter || 0)}</div>
                                        ` : ''}
                                        <div class="overlay"></div>
                                    </div>
                                    <p class="title">${item.title}</p>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    async afterRender() {
        // Click handlers for library items
        document.querySelectorAll('.library-item').forEach(item => {
            item.addEventListener('click', (e) => this.handleItemClick(e));
            item.addEventListener('contextmenu', (e) => this.handleItemLongPress(e));
            item.addEventListener('touchstart', (e) => this.startLongPress(item, e));
            item.addEventListener('touchend', () => this.cancelLongPress());
        });

        // Click handlers for continue watching items
        document.querySelectorAll('.continue-item').forEach(item => {
            item.addEventListener('click', (e) => this.handleContinueClick(e));
        });
    }

    async handleItemClick(e) {
        const itemElement = e.currentTarget;
        const itemId = itemElement.dataset.id;
        const item = this.library.find(i => i.id === itemId);

        if (item) {
            const detail = new CustomEvent('navigateToDetail', {
                detail: { item, source: 'library' }
            });
            document.dispatchEvent(detail);
        }
    }

    async handleContinueClick(e) {
        const itemElement = e.currentTarget;
        const itemId = itemElement.dataset.id;
        const item = this.library.find(i => i.id === itemId);

        if (item && item.progress) {
            const detail = new CustomEvent('navigateToDetail', {
                detail: { item, source: 'library' }
            });
            document.dispatchEvent(detail);
        }
    }

    handleItemLongPress(e) {
        e.preventDefault();
        this.showDeleteMenu(e.currentTarget);
    }

    startLongPress(item, e) {
        this.longPressTimer = setTimeout(() => {
            this.showDeleteMenu(item);
        }, 500);
    }

    cancelLongPress() {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
        }
    }

    showDeleteMenu(itemElement) {
        const itemId = itemElement.dataset.id;
        const item = this.library.find(i => i.id === itemId);

        const dialog = document.createElement('div');
        dialog.className = 'delete-dialog';
        dialog.innerHTML = `
            <div class="dialog-content">
                <p>Delete "${item.title}" from library?</p>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                    <button class="btn btn-danger" data-action="delete">Delete</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const deleteBtn = dialog.querySelector('[data-action="delete"]');
        const cancelBtn = dialog.querySelector('[data-action="cancel"]');

        deleteBtn.addEventListener('click', async () => {
            try {
                await db.deleteFromLibrary(itemId);
                showToast(`Removed "${item.title}"`, 'success');
                dialog.remove();
                // Reload screen
                const html = await this.render();
                document.querySelector('.screen-container').innerHTML = html;
                await this.afterRender();
            } catch (error) {
                console.error('Delete error:', error);
                showToast('Failed to delete item', 'error');
            }
        });

        cancelBtn.addEventListener('click', () => {
            dialog.remove();
        });
    }

    getProgressPercent(item) {
        if (item.type === 'anime') {
            const total = item.episodes || 1;
            const current = item.progress.currentEpisode || 0;
            return Math.round((current / total) * 100);
        } else {
            const total = item.chapters || 1;
            const current = item.progress.currentChapter || 0;
            return Math.round((current / total) * 100);
        }
    }
}
