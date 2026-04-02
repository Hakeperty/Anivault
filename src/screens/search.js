/**
 * Search Screen - Multi-source anime/manga search
 */

import { SearchCoordinator } from '../scrapers/coordinator.js';
import { showToast } from '../utils/toast.js';

export class SearchScreen {
    constructor() {
        this.searchResults = [];
        this.activeFilter = 'both';
        this.debounceTimer = null;
        this.isSearching = false;
        this.lastQuery = '';
    }

    async render() {
        return `
            <div class="screen search-screen">
                <div class="search-header">
                    <div class="search-bar">
                        <svg class="search-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="search-input" class="search-input" placeholder="Search anime or manga..." autocomplete="off">
                        <button id="search-clear" class="search-clear hidden">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                    <div class="search-filters">
                        <button class="filter-btn active" data-filter="both">All</button>
                        <button class="filter-btn" data-filter="anime">Anime</button>
                        <button class="filter-btn" data-filter="manga">Manga</button>
                    </div>
                </div>
                <div id="search-status" class="search-status"></div>
                <div id="search-results" class="search-results-grid"></div>
                <div id="search-empty" class="search-empty-state">
                    <svg class="empty-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <p>Search across multiple sources</p>
                    <p class="search-hint">Find anime and manga from AniWatch, Jikan, MangaDex, MangaKatana</p>
                </div>
            </div>
        `;
    }

    async afterRender() {
        const input = document.getElementById('search-input');
        const clearBtn = document.getElementById('search-clear');

        input?.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearBtn?.classList.toggle('hidden', !query);
            this.debounceSearch(query);
        });

        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = input.value.trim();
                if (query) this.executeSearch(query);
            }
        });

        clearBtn?.addEventListener('click', () => {
            input.value = '';
            clearBtn.classList.add('hidden');
            this.clearResults();
            input.focus();
        });

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeFilter = btn.dataset.filter;
                if (this.lastQuery) this.executeSearch(this.lastQuery);
            });
        });

        // Restore previous results if any
        if (this.searchResults.length > 0) {
            this.renderResults();
        }

        // Auto-focus the input
        setTimeout(() => input?.focus(), 100);
    }

    debounceSearch(query) {
        clearTimeout(this.debounceTimer);
        if (!query) {
            this.clearResults();
            return;
        }
        this.debounceTimer = setTimeout(() => this.executeSearch(query), 500);
    }

    async executeSearch(query) {
        if (this.isSearching || !query) return;

        this.isSearching = true;
        this.lastQuery = query;
        this.showLoading(query);

        try {
            const results = await SearchCoordinator.searchAll(query, this.activeFilter);
            this.searchResults = results.all || [];

            // Deduplicate by title similarity
            this.searchResults = this.deduplicateResults(this.searchResults);

            this.renderResults();

            const count = this.searchResults.length;
            if (count === 0) {
                this.showNoResults(query);
            } else {
                this.showResultCount(count, query);
            }
        } catch (error) {
            console.error('Search error:', error);
            showToast('Search failed — try again', 'error');
            this.showError();
        } finally {
            this.isSearching = false;
        }
    }

    deduplicateResults(results) {
        const seen = new Map();
        return results.filter(item => {
            const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (seen.has(key)) return false;
            seen.set(key, true);
            return true;
        });
    }

    renderResults() {
        const container = document.getElementById('search-results');
        const emptyState = document.getElementById('search-empty');
        if (!container) return;

        emptyState?.classList.add('hidden');

        container.innerHTML = this.searchResults.map(item => `
            <div class="search-result-item" data-id="${item.id}" data-source="${item.source}" data-type="${item.type || 'anime'}">
                <div class="result-cover-wrapper">
                    <img src="${item.coverImage || item.coverUrl || ''}" 
                         alt="${item.title}" 
                         class="result-cover"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 140%22><rect fill=%22%231f1f1f%22 width=%22100%22 height=%22140%22/><text x=%2250%22 y=%2270%22 fill=%22%23555%22 text-anchor=%22middle%22 font-size=%2212%22>No Image</text></svg>'">
                    <span class="result-type-badge ${item.type || 'anime'}">${item.type === 'manga' ? 'Manga' : 'Anime'}</span>
                    <span class="result-source-badge">${this.formatSource(item.source)}</span>
                </div>
                <p class="result-title">${item.title}</p>
            </div>
        `).join('');

        // Attach click handlers
        container.querySelectorAll('.search-result-item').forEach(el => {
            el.addEventListener('click', () => this.handleResultClick(el));
        });
    }

    handleResultClick(el) {
        const id = el.dataset.id;
        const source = el.dataset.source;
        const type = el.dataset.type;
        const item = this.searchResults.find(r => r.id === id && r.source === source);

        if (item) {
            const event = new CustomEvent('navigateToDetail', {
                detail: {
                    item: {
                        id: item.id,
                        title: item.title,
                        coverImage: item.coverImage || item.coverUrl || '',
                        description: item.description || '',
                        type: item.type || type,
                        source: item.source,
                        url: item.url,
                        genres: item.genres || [],
                        chapters: item.chapters || null,
                        episodes: item.episodes || null
                    },
                    source: item.source
                }
            });
            document.dispatchEvent(event);
        }
    }

    formatSource(source) {
        const names = {
            hianime: 'HiAnime',
            aniwatch: 'AniWatch',
            mangadex: 'MangaDex',
            mangakatana: 'MangaKatana'
        };
        return names[source] || source;
    }

    showLoading(query) {
        const status = document.getElementById('search-status');
        const results = document.getElementById('search-results');
        const emptyState = document.getElementById('search-empty');

        if (emptyState) emptyState.classList.add('hidden');
        if (status) {
            status.innerHTML = `
                <div class="search-loading">
                    <div class="spinner"></div>
                    <span>Searching for "${query}"...</span>
                </div>
            `;
        }
        if (results) results.innerHTML = '';
    }

    showResultCount(count, query) {
        const status = document.getElementById('search-status');
        if (status) {
            status.innerHTML = `<span class="result-count">${count} result${count !== 1 ? 's' : ''} for "${query}"</span>`;
        }
    }

    showNoResults(query) {
        const status = document.getElementById('search-status');
        const results = document.getElementById('search-results');
        if (status) status.innerHTML = '';
        if (results) {
            results.innerHTML = `
                <div class="no-results">
                    <svg class="no-results-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    <p>No results for "${query}"</p>
                    <p class="search-hint">Try different keywords or switch the filter</p>
                </div>
            `;
        }
    }

    showError() {
        const status = document.getElementById('search-status');
        if (status) status.innerHTML = '<span class="search-error">Something went wrong. Try again.</span>';
    }

    clearResults() {
        this.searchResults = [];
        this.lastQuery = '';
        const status = document.getElementById('search-status');
        const results = document.getElementById('search-results');
        const emptyState = document.getElementById('search-empty');
        if (status) status.innerHTML = '';
        if (results) results.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
    }
}
