/**
 * Discover Screen - Trending anime & popular manga
 * Fetches from Jikan (MAL) for anime and MangaDex for manga.
 */

import { SearchCoordinator } from '../scrapers/coordinator.js';
import { showToast } from '../utils/toast.js';
import { db } from '../db/indexeddb.js';

export class DiscoverScreen {
    constructor() {
        this._cache = null;
        this._cacheTime = 0;
        this._loading = false;
    }

    async render() {
        return `
            <div class="screen discover-screen">
                <div class="screen-header">
                    <h1>Discover</h1>
                    <button id="discover-refresh" class="discover-refresh-btn" aria-label="Refresh">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
                            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                    </button>
                </div>
                <div id="discover-content" class="discover-content">
                    <div class="discover-loading">
                        <div class="spinner"></div>
                        <span>Loading trending...</span>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        document.getElementById('discover-refresh')?.addEventListener('click', () => {
            this._cache = null;
            this._loadContent();
        });
        this._loadContent();
    }

    async _loadContent() {
        if (this._loading) return;

        const container = document.getElementById('discover-content');
        if (!container) return;

        // Always fetch fresh continue-watching from DB
        let continueWatching = [];
        try {
            const library = await db.getLibrary();
            continueWatching = library
                .filter(item => item.progress && (item.progress.currentEpisode || item.progress.currentChapter))
                .sort((a, b) => new Date(b.progress.lastUpdated || 0) - new Date(a.progress.lastUpdated || 0))
                .slice(0, 12);
        } catch (e) { /* ignore */ }

        // Use cache if less than 5 minutes old
        const CACHE_TTL = 5 * 60 * 1000;
        if (this._cache && (Date.now() - this._cacheTime < CACHE_TTL)) {
            container.innerHTML = this._buildContinueWatching(continueWatching) + this._buildSections(this._cache);
            this._bindCards(container);
            this._bindContinue(container);
            return;
        }

        this._loading = true;
        container.innerHTML = this._buildContinueWatching(continueWatching) + `
            <div class="discover-loading">
                <div class="spinner"></div>
                <span>Loading trending...</span>
            </div>`;
        this._bindContinue(container);

        try {
            const data = await SearchCoordinator.getTrending();
            this._cache = data;
            this._cacheTime = Date.now();

            if (!document.getElementById('discover-content')) return;
            container.innerHTML = this._buildContinueWatching(continueWatching) + this._buildSections(data);
            this._bindCards(container);
            this._bindContinue(container);
        } catch (err) {
            console.error('Discover load error:', err);
            container.innerHTML = this._buildContinueWatching(continueWatching) + `
                <div class="discover-error">
                    <p>Failed to load trending content</p>
                    <button class="btn btn-secondary" id="discover-retry">Retry</button>
                </div>`;
            this._bindContinue(container);
            document.getElementById('discover-retry')?.addEventListener('click', () => {
                this._cache = null;
                this._loadContent();
            });
        } finally {
            this._loading = false;
        }
    }

    _buildContinueWatching(items) {
        if (!items || items.length === 0) return '';

        const cards = items.map(item => {
            const epOrCh = item.type === 'anime'
                ? `Ep ${item.progress.currentEpisode || '?'}${item.episodes ? '/' + item.episodes : ''}`
                : `Ch ${item.progress.currentChapter || '?'}${item.chapters ? '/' + item.chapters : ''}`;
            return `
                <div class="discover-continue-card" data-id="${item.id}">
                    <div class="discover-continue-cover">
                        <img src="${item.coverImage || ''}" alt="${this._esc(item.title)}" loading="lazy"
                             onerror="this.style.display='none'">
                        <div class="discover-continue-progress">
                            <div class="discover-continue-progress-fill" style="width:${this._getProgress(item)}%"></div>
                        </div>
                    </div>
                    <p class="discover-continue-title">${this._esc(item.title)}</p>
                    <p class="discover-continue-ep">${epOrCh}</p>
                </div>
            `;
        }).join('');

        return `
            <div class="discover-section">
                <h2 class="discover-section-title">▶️ Continue Watching</h2>
                <div class="discover-row">${cards}</div>
            </div>
        `;
    }

    _bindContinue(container) {
        container.querySelectorAll('.discover-continue-card').forEach(card => {
            card.addEventListener('click', async () => {
                const id = card.dataset.id;
                try {
                    const item = await db.getLibraryItem(id);
                    if (item) {
                        document.dispatchEvent(new CustomEvent('navigateToDetail', {
                            detail: { item, source: item.source || 'library' }
                        }));
                    }
                } catch (e) {
                    console.error('Continue click error:', e);
                }
            });
        });
    }

    _getProgress(item) {
        if (item.type === 'anime') {
            const total = item.episodes || 1;
            return Math.round(((item.progress?.currentEpisode || 0) / total) * 100);
        }
        const total = item.chapters || 1;
        return Math.round(((item.progress?.currentChapter || 0) / total) * 100);
    }

    _buildSections(data) {
        let html = '';

        if (data.airing?.length) {
            html += this._section('🔥 Top Airing', data.airing, 'airing');
        }
        if (data.popular?.length) {
            html += this._section('⭐ Most Popular Anime', data.popular, 'popular');
        }
        if (data.mangaPopular?.length) {
            html += this._section('📚 Popular Manga', data.mangaPopular, 'manga-pop');
        }
        if (data.mangaRecent?.length) {
            html += this._section('🆕 Recently Updated Manga', data.mangaRecent, 'manga-new');
        }
        if (data.upcoming?.length) {
            html += this._section('📅 Upcoming Anime', data.upcoming, 'upcoming');
        }

        if (!html) {
            html = `<div class="discover-error"><p>No trending content available right now</p></div>`;
        }

        return html;
    }

    _section(title, items, sectionId) {
        const cards = items.map((item, i) => `
            <div class="discover-card" data-id="${item.id}" data-source="${item.source}" data-type="${item.type || 'anime'}" style="animation-delay: ${Math.min(i * 0.03, 0.3)}s">
                <div class="discover-card-cover">
                    <img src="${item.coverImage || ''}" alt="${this._esc(item.title)}" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 140%22><rect fill=%22%231a1a1a%22 width=%22100%22 height=%22140%22/><text x=%2250%22 y=%2270%22 fill=%22%23444%22 text-anchor=%22middle%22 font-size=%2210%22>No Image</text></svg>'">
                    ${item.score ? `<span class="discover-score">★ ${item.score}</span>` : ''}
                    <span class="discover-type-pill ${item.type || 'anime'}">${item.type === 'manga' ? 'Manga' : 'Anime'}</span>
                </div>
                <p class="discover-card-title">${this._esc(item.title)}</p>
                ${item.genres?.length ? `<p class="discover-card-genre">${item.genres.slice(0, 2).join(' · ')}</p>` : ''}
            </div>
        `).join('');

        return `
            <div class="discover-section" data-section="${sectionId}">
                <h2 class="discover-section-title">${title}</h2>
                <div class="discover-row">${cards}</div>
            </div>
        `;
    }

    _bindCards(container) {
        container.querySelectorAll('.discover-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const source = card.dataset.source;
                const type = card.dataset.type;

                // Find the item in cache
                let item = null;
                if (this._cache) {
                    for (const list of Object.values(this._cache)) {
                        item = list.find(r => r.id === id && r.source === source);
                        if (item) break;
                    }
                }
                if (!item) return;

                document.dispatchEvent(new CustomEvent('navigateToDetail', {
                    detail: {
                        item: {
                            id: item.id,
                            title: item.title,
                            coverImage: item.coverImage || '',
                            description: item.description || '',
                            type: item.type || type,
                            source: item.source,
                            url: item.url || '',
                            genres: item.genres || [],
                            episodes: item.episodes || null,
                            chapters: item.chapters || null,
                            score: item.score || null
                        },
                        source: item.source
                    }
                }));
            });
        });
    }

    _esc(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    deactivate() {
        // Keep cache alive across navigations
    }
}
