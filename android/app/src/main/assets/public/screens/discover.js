/**
 * Discover Screen - Trending anime, seasonal, recommendations & popular manga
 * Fetches from Jikan (MAL) for anime and MangaDex for manga.
 */

import { SearchCoordinator } from '../scrapers/coordinator.js';
import { showToast } from '../utils/toast.js';
import { db } from '../db/indexeddb.js';

// Inline SVG section icons (replace emojis)
const ICONS = {
    play: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><polygon points="4 2 18 10 4 18"/></svg>',
    fire: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 0C10 0 6 5 6 9a4 4 0 0 0 8 0c0-1.5-.7-3-2-5 2 3 4 5.5 4 8a6 6 0 1 1-12 0C4 7 7 3 10 0z"/></svg>',
    star: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 1l2.39 4.84 5.34.78-3.87 3.77.91 5.33L10 13.27l-4.77 2.51.91-5.33L2.27 6.68l5.34-.78z"/></svg>',
    seasonal: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 2a1 1 0 0 1 1 1v1.07A7 7 0 0 1 17 11a7 7 0 1 1-14 0 7 7 0 0 1 6-6.93V3a1 1 0 0 1 1-1zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm.5 2v3.5l2.5 1.5-.5.87L10 12V8h.5z"/></svg>',
    book: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M2 3a2 2 0 0 1 2-1h4a2 2 0 0 1 2 1v14l-1-.5-3-1.5-3 1.5-1 .5V3zm8 0a2 2 0 0 1 2-1h4a2 2 0 0 1 2 1v14l-1-.5-3-1.5-3 1.5-1 .5V3z"/></svg>',
    sparkle: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2zM15 12l.75 2.25L18 15l-2.25.75L15 18l-.75-2.25L12 15l2.25-.75z"/></svg>',
    calendar: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M6 1v2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2V1h-2v2H8V1H6zm-2 6h12v10H4V7z"/></svg>',
    recommend: '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M2 10.5a8.5 8.5 0 1 1 17 0c0 .28-.01.55-.04.82l-1.98-.17c.02-.22.02-.43.02-.65a6.5 6.5 0 1 0-6.5 6.5c.22 0 .43 0 .65-.02l.17 1.98c-.27.03-.54.04-.82.04A8.5 8.5 0 0 1 2 10.5zm12.5 2l2 3 3-4"/></svg>',
};

export class DiscoverScreen {
    constructor() {
        this._cache = null;
        this._cacheTime = 0;
        this._loading = false;
        this._recommendations = null;
        this._userRecommends = null;
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
                <button id="scroll-to-top" class="scroll-to-top" aria-label="Scroll to top">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
            </div>
        `;
    }

    async afterRender() {
        document.getElementById('discover-refresh')?.addEventListener('click', () => {
            this._cache = null;
            this._recommendations = null;
            this._userRecommends = null;
            this._loadContent();
        });

        // Scroll-to-top button
        const scrollBtn = document.getElementById('scroll-to-top');
        const discoverScreen = document.querySelector('.discover-screen');
        if (scrollBtn && discoverScreen) {
            discoverScreen.addEventListener('scroll', () => {
                scrollBtn.classList.toggle('visible', discoverScreen.scrollTop > 400);
            });
            scrollBtn.addEventListener('click', () => {
                discoverScreen.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }

        this._loadContent();
    }

    async _loadContent() {
        if (this._loading) return;

        const container = document.getElementById('discover-content');
        if (!container) return;

        // Always fetch fresh continue-watching from DB
        let continueWatching = [];
        let libraryItems = [];
        let userRecs = [];
        try {
            libraryItems = await db.getLibrary();
            continueWatching = libraryItems
                .filter(item => item.progress && (item.progress.currentEpisode || item.progress.currentChapter))
                .sort((a, b) => new Date(b.progress.lastUpdated || 0) - new Date(a.progress.lastUpdated || 0))
                .slice(0, 12);
        } catch (e) { /* ignore */ }

        // Fetch user recommendations
        try {
            userRecs = await db.getRecommendations();
            userRecs.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
            this._userRecommends = userRecs;
        } catch (e) { this._userRecommends = []; }

        // Use cache if less than configured duration old
        let cacheTTL = 10 * 60 * 1000; // default 10 min
        try {
            const cacheMins = await db.getSetting('discoverCache', '10');
            cacheTTL = parseInt(cacheMins, 10) * 60 * 1000;
        } catch {}
        if (this._cache && (Date.now() - this._cacheTime < cacheTTL)) {
            container.innerHTML = this._buildContinueWatching(continueWatching)
                + this._buildUserRecommends()
                + this._buildRecommendations()
                + this._buildSections(this._cache);
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
            // Fetch trending and recommendations in parallel
            const settled = await Promise.allSettled([
                SearchCoordinator.getTrending(),
                libraryItems.length > 0
                    ? SearchCoordinator.getRecommendations(libraryItems)
                    : Promise.resolve([])
            ]);

            const data = settled[0].status === 'fulfilled' ? settled[0].value : {
                airing: [], popular: [], upcoming: [], seasonNow: [],
                mangaPopular: [], mangaRecent: [], weeklySchedule: {}
            };
            const recs = settled[1].status === 'fulfilled' ? settled[1].value : [];

            this._cache = data;
            this._cacheTime = Date.now();
            this._recommendations = recs;

            if (!document.getElementById('discover-content')) return;
            container.innerHTML = this._buildContinueWatching(continueWatching)
                + this._buildUserRecommends()
                + this._buildRecommendations()
                + this._buildSections(data);
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
                <h2 class="discover-section-title"><span class="section-icon play">${ICONS.play}</span>Continue Watching</h2>
                <div class="discover-row">${cards}</div>
            </div>
        `;
    }

    _buildRecommendations() {
        if (!this._recommendations || this._recommendations.length === 0) return '';
        return this._section(
            `<span class="section-icon recommend">${ICONS.recommend}</span>Recommended For You`,
            this._recommendations,
            'recommended'
        );
    }

    _buildUserRecommends() {
        if (!this._userRecommends || this._userRecommends.length === 0) return '';
        return this._section(
            `<span class="section-icon user-recommend">${ICONS.star}</span>User Recommends`,
            this._userRecommends,
            'user-recommends'
        );
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
            return Math.min(100, Math.round(((item.progress?.currentEpisode || 0) / total) * 100));
        }
        const total = item.chapters || 1;
        return Math.min(100, Math.round(((item.progress?.currentChapter || 0) / total) * 100));
    }

    _buildSections(data) {
        let html = '';

        // Weekly Schedule — special tabbed section
        if (data.weeklySchedule && Object.values(data.weeklySchedule).some(d => d?.length)) {
            html += this._buildWeeklySchedule(data.weeklySchedule);
        }

        if (data.seasonNow?.length) {
            html += this._section(
                `<span class="section-icon seasonal">${ICONS.seasonal}</span>This Season`,
                data.seasonNow, 'season-now'
            );
        }
        if (data.airing?.length) {
            html += this._section(
                `<span class="section-icon fire">${ICONS.fire}</span>Top Airing`,
                data.airing, 'airing'
            );
        }
        if (data.popular?.length) {
            html += this._section(
                `<span class="section-icon star">${ICONS.star}</span>Most Popular`,
                data.popular, 'popular'
            );
        }
        if (data.mangaPopular?.length) {
            html += this._section(
                `<span class="section-icon book">${ICONS.book}</span>Popular Manga`,
                data.mangaPopular, 'manga-pop'
            );
        }
        if (data.mangaRecent?.length) {
            html += this._section(
                `<span class="section-icon sparkle">${ICONS.sparkle}</span>Recently Updated Manga`,
                data.mangaRecent, 'manga-new'
            );
        }
        if (data.upcoming?.length) {
            html += this._section(
                `<span class="section-icon calendar">${ICONS.calendar}</span>Upcoming Anime`,
                data.upcoming, 'upcoming'
            );
        }

        if (!html) {
            html = `<div class="discover-error"><p>No trending content available right now</p></div>`;
        }

        return html;
    }

    _buildWeeklySchedule(schedule) {
        const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        // Find today's day (JST approximation: UTC + 9)
        const now = new Date();
        const jstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
        // getUTCDay: 0=Sun, so map: Sun=6, Mon=0, Tue=1, ...
        const todayIdx = jstDay === 0 ? 6 : jstDay - 1;

        const tabs = DAYS.map((day, i) => {
            const isToday = i === todayIdx;
            const count = schedule[day]?.length || 0;
            return `<button class="schedule-tab${isToday ? ' active' : ''}" data-day="${day}">
                ${SHORT[i]}${isToday ? ' <span class="schedule-today-dot">●</span>' : ''}
                ${count > 0 ? `<span class="schedule-count">${count}</span>` : ''}
            </button>`;
        }).join('');

        // Build card rows for each day (only active day visible)
        const dayPanels = DAYS.map((day, i) => {
            const items = schedule[day] || [];
            const isToday = i === todayIdx;
            if (items.length === 0) {
                return `<div class="schedule-panel${isToday ? ' active' : ''}" data-day-panel="${day}">
                    <p class="schedule-empty">No anime airing on ${SHORT[i]}</p>
                </div>`;
            }
            const cards = items.map((item, ci) => {
                return `
                <div class="discover-card" data-id="${item.id}" data-source="${item.source}" data-type="anime" style="animation-delay: ${Math.min(ci * 0.03, 0.3)}s">
                    <div class="discover-card-cover">
                        <img src="${item.coverImage || ''}" alt="${this._esc(item.title)}" loading="lazy"
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 140%22><rect fill=%22%231a1a1a%22 width=%22100%22 height=%22140%22/><text x=%2250%22 y=%2270%22 fill=%22%23444%22 text-anchor=%22middle%22 font-size=%2210%22>No Image</text></svg>'">
                        ${item.score ? `<span class="discover-score">★ ${item.score}</span>` : ''}
                        <span class="discover-type-pill anime">Anime</span>
                    </div>
                    <p class="discover-card-title">${this._esc(item.title)}</p>
                    ${item.broadcast ? `<p class="discover-card-genre">${this._esc(item.broadcast)}</p>` : ''}
                    ${!item.broadcast && item.genres?.length ? `<p class="discover-card-genre">${item.genres.slice(0, 2).join(' · ')}</p>` : ''}
                </div>`;
            }).join('');
            return `<div class="schedule-panel${isToday ? ' active' : ''}" data-day-panel="${day}">
                <div class="discover-row">${cards}</div>
            </div>`;
        }).join('');

        return `
            <div class="discover-section" data-section="weekly-schedule">
                <h2 class="discover-section-title">
                    <span class="section-icon schedule">${ICONS.calendar}</span>Airing This Week
                </h2>
                <div class="schedule-tabs">${tabs}</div>
                <div class="schedule-panels">${dayPanels}</div>
            </div>
        `;
    }

    _section(title, items, sectionId) {
        const cards = items.map((item, i) => {
            const yearBadge = item.year ? `<span class="discover-year">${item.year}</span>` : '';
            return `
            <div class="discover-card" data-id="${item.id}" data-source="${item.source}" data-type="${item.type || 'anime'}" style="animation-delay: ${Math.min(i * 0.03, 0.3)}s">
                <div class="discover-card-cover">
                    <img src="${item.coverImage || ''}" alt="${this._esc(item.title)}" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 140%22><rect fill=%22%231a1a1a%22 width=%22100%22 height=%22140%22/><text x=%2250%22 y=%2270%22 fill=%22%23444%22 text-anchor=%22middle%22 font-size=%2210%22>No Image</text></svg>'">
                    ${item.score ? `<span class="discover-score">★ ${item.score}</span>` : ''}
                    <span class="discover-type-pill ${item.type || 'anime'}">${item.type === 'manga' ? 'Manga' : 'Anime'}</span>
                    ${yearBadge}
                </div>
                <p class="discover-card-title">${this._esc(item.title)}</p>
                ${item.genres?.length ? `<p class="discover-card-genre">${item.genres.slice(0, 2).join(' · ')}</p>` : ''}
            </div>
            `;
        }).join('');

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

                // Find the item in cache or recommendations
                let item = null;
                const allLists = [];
                if (this._cache) {
                    for (const [key, val] of Object.entries(this._cache)) {
                        if (key === 'weeklySchedule' && val && typeof val === 'object') {
                            // weeklySchedule is { monday: [...], ... }
                            for (const dayItems of Object.values(val)) {
                                if (Array.isArray(dayItems)) allLists.push(dayItems);
                            }
                        } else if (Array.isArray(val)) {
                            allLists.push(val);
                        }
                    }
                }
                if (this._recommendations) allLists.push(this._recommendations);
                if (this._userRecommends) allLists.push(this._userRecommends);

                for (const list of allLists) {
                    item = list.find(r => r.id === id && r.source === source);
                    if (item) break;
                }
                if (!item) return;

                document.dispatchEvent(new CustomEvent('navigateToDetail', {
                    detail: {
                        item: {
                            id: item.id,
                            title: item.title,
                            titleEnglish: item.titleEnglish || '',
                            coverImage: item.coverImage || '',
                            description: item.description || '',
                            type: item.type || type,
                            source: item.source,
                            url: item.url || '',
                            genres: item.genres || [],
                            genreIds: item.genreIds || [],
                            episodes: item.episodes || null,
                            chapters: item.chapters || null,
                            score: item.score || null
                        },
                        source: item.source
                    }
                }));
            });
        });

        // Schedule tab switching
        container.querySelectorAll('.schedule-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const day = tab.dataset.day;
                // Update active tab
                container.querySelectorAll('.schedule-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                // Show corresponding panel
                container.querySelectorAll('.schedule-panel').forEach(p => p.classList.remove('active'));
                const panel = container.querySelector(`.schedule-panel[data-day-panel="${day}"]`);
                if (panel) panel.classList.add('active');
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
