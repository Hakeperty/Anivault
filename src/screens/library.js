/**
 * Library Screen - Shows user's library of anime/manga
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';

export class LibraryScreen {
    constructor() {
        this.library = [];
        this.continueWatching = [];
        this.filterType = 'all';
        this.searchQuery = '';
        this.sortBy = localStorage.getItem('anivault-library-sort') || 'updated';
    }

    async render() {
        this.library = await db.getLibrary();
        this.continueWatching = this.library
            .filter(item => item.progress && (item.progress.currentEpisode || item.progress.currentChapter))
            .sort((a, b) => new Date(b.progress.lastUpdated) - new Date(a.progress.lastUpdated))
            .slice(0, 10);

        const filtered = this.getFilteredLibrary();

        return `
            <div class="screen library-screen">
                <div class="screen-header">
                    <h1>Library</h1>
                    <span class="library-count">${this.library.length} titles</span>
                </div>

                ${this.library.length > 0 ? `
                    <div class="library-toolbar">
                        <div class="library-search-bar">
                            <svg class="library-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="20" y2="20"/></svg>
                            <input type="text" id="library-search" class="library-search-input" placeholder="Filter library...">
                        </div>
                        <div class="library-toolbar-row">
                            <div class="library-filters">
                                <button class="filter-chip ${this.filterType === 'all' ? 'active' : ''}" data-type="all">All</button>
                                <button class="filter-chip ${this.filterType === 'anime' ? 'active' : ''}" data-type="anime">Anime</button>
                                <button class="filter-chip ${this.filterType === 'manga' ? 'active' : ''}" data-type="manga">Manga</button>
                            </div>
                            <select id="library-sort" class="library-sort-select">
                                <option value="updated" ${this.sortBy === 'updated' ? 'selected' : ''}>Recently Updated</option>
                                <option value="added" ${this.sortBy === 'added' ? 'selected' : ''}>Date Added</option>
                                <option value="alpha" ${this.sortBy === 'alpha' ? 'selected' : ''}>A → Z</option>
                                <option value="alpha-desc" ${this.sortBy === 'alpha-desc' ? 'selected' : ''}>Z → A</option>
                                <option value="progress" ${this.sortBy === 'progress' ? 'selected' : ''}>Progress %</option>
                            </select>
                        </div>
                    </div>
                ` : ''}

                ${this.continueWatching.length > 0 ? `
                    <div class="section">
                        <h2>Continue</h2>
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
                    ${this.library.length === 0 ? `
                        <div class="empty-state">
                            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                            <h2>Your library is empty</h2>
                            <p>Search for anime or manga to add to your collection</p>
                            <button id="empty-search-btn" class="btn btn-primary" style="margin-top:12px;">Start Searching</button>
                        </div>
                    ` : `
                        <div id="library-grid" class="library-grid">
                            ${filtered.map(item => this.renderLibraryItem(item)).join('')}
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    renderLibraryItem(item) {
        const progressPct = this.getProgressPercent(item);
        const epLabel = item.type === 'anime'
            ? `Ep ${item.progress?.currentEpisode || 0}${item.episodes ? '/' + item.episodes : ''}`
            : `Ch ${item.progress?.currentChapter || 0}${item.chapters ? '/' + item.chapters : ''}`;
        const hasProgress = item.progress && (item.progress.currentEpisode || item.progress.currentChapter);

        return `
            <div class="library-item" data-id="${item.id}">
                <div class="cover-wrapper">
                    <img src="${item.coverImage}" alt="${item.title}" class="cover"
                         onerror="this.style.display='none'">
                    ${hasProgress ? `<span class="library-ep-badge">${epLabel}</span>` : ''}
                    ${progressPct > 0 ? `
                        <div class="library-item-progress">
                            <div class="library-item-progress-fill" style="width:${Math.min(progressPct, 100)}%"></div>
                        </div>
                    ` : ''}
                    <div class="overlay"></div>
                </div>
                <p class="title">${item.title}</p>
            </div>
        `;
    }

    getFilteredLibrary() {
        let items = this.library.filter(item => {
            const matchesType = this.filterType === 'all' || item.type === this.filterType;
            const matchesSearch = !this.searchQuery || 
                item.title.toLowerCase().includes(this.searchQuery.toLowerCase());
            return matchesType && matchesSearch;
        });

        // Sort
        switch (this.sortBy) {
            case 'alpha':
                items.sort((a, b) => a.title.localeCompare(b.title));
                break;
            case 'alpha-desc':
                items.sort((a, b) => b.title.localeCompare(a.title));
                break;
            case 'progress':
                items.sort((a, b) => this.getProgressPercent(b) - this.getProgressPercent(a));
                break;
            case 'updated':
                items.sort((a, b) => {
                    const aDate = a.progress?.lastUpdated || a.addedAt || 0;
                    const bDate = b.progress?.lastUpdated || b.addedAt || 0;
                    return new Date(bDate) - new Date(aDate);
                });
                break;
            case 'added':
            default:
                items.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
                break;
        }

        return items;
    }

    async afterRender() {
        // Library item clicks
        document.querySelectorAll('.library-item').forEach(item => {
            item.addEventListener('click', (e) => this.handleItemClick(e));
            item.addEventListener('contextmenu', (e) => this.handleItemLongPress(e));
            item.addEventListener('touchstart', (e) => this.startLongPress(item, e));
            item.addEventListener('touchend', () => this.cancelLongPress());
        });

        // Continue watching clicks
        document.querySelectorAll('.continue-item').forEach(item => {
            item.addEventListener('click', (e) => this.handleContinueClick(e));
        });

        // Library search
        document.getElementById('library-search')?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.trim();
            this.updateGrid();
        });

        // Filter chips
        document.querySelectorAll('.filter-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.filterType = btn.dataset.type;
                this.updateGrid();
            });
        });

        // Sort select
        document.getElementById('library-sort')?.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            localStorage.setItem('anivault-library-sort', this.sortBy);
            this.updateGrid();
        });

        // Empty state → Search
        document.getElementById('empty-search-btn')?.addEventListener('click', () => {
            document.querySelector('.nav-btn[data-screen="search"]')?.click();
        });
    }

    updateGrid() {
        const grid = document.getElementById('library-grid');
        if (!grid) return;
        const filtered = this.getFilteredLibrary();
        grid.innerHTML = filtered.map(item => this.renderLibraryItem(item)).join('');

        // Reattach handlers
        grid.querySelectorAll('.library-item').forEach(item => {
            item.addEventListener('click', (e) => this.handleItemClick(e));
            item.addEventListener('contextmenu', (e) => this.handleItemLongPress(e));
            item.addEventListener('touchstart', (e) => this.startLongPress(item, e));
            item.addEventListener('touchend', () => this.cancelLongPress());
        });
    }

    async handleItemClick(e) {
        const itemElement = e.currentTarget;
        const itemId = itemElement.dataset.id;
        const item = this.library.find(i => i.id === itemId);

        if (item) {
            document.dispatchEvent(new CustomEvent('navigateToDetail', {
                detail: { item, source: 'library' }
            }));
        }
    }

    async handleContinueClick(e) {
        const itemElement = e.currentTarget;
        const itemId = itemElement.dataset.id;
        const item = this.library.find(i => i.id === itemId);

        if (item && item.progress) {
            document.dispatchEvent(new CustomEvent('navigateToDetail', {
                detail: { item, source: 'library' }
            }));
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
                <p>Remove "${item.title}" from library?</p>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                    <button class="btn btn-danger" data-action="delete">Remove</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        dialog.querySelector('[data-action="delete"]').addEventListener('click', async () => {
            try {
                await db.removeFromLibrary(itemId);
                showToast(`Removed "${item.title}"`, 'success');
                dialog.remove();
                const html = await this.render();
                document.getElementById('screen-container').innerHTML = html;
                await this.afterRender();
            } catch (error) {
                console.error('Delete error:', error);
                showToast('Failed to remove item', 'error');
            }
        });

        dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            dialog.remove();
        });

        // Close on overlay click
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.remove();
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
