/**
 * Detail Screen - Shows anime/manga metadata and episodes/chapters
 */

import { SearchCoordinator } from '../scrapers/coordinator.js';
import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';

export class DetailScreen {
    constructor(item, source) {
        this.item = item;
        this.source = source;
        this.episodes = [];
        this.chapters = [];
        this.isInLibrary = false;
        this.isLoadingContent = false;
    }

    async render() {
        // Check if already in library
        try {
            const existing = await db.getLibraryItem(this.item.id);
            this.isInLibrary = !!existing;
        } catch (e) {
            this.isInLibrary = false;
        }

        const type = this.item.type || 'anime';
        const genres = (this.item.genres || []).slice(0, 6);
        const description = this.item.description || '';
        const truncatedDesc = description.length > 300 ? description.substring(0, 300) + '...' : description;

        return `
            <div class="screen detail-screen">
                <div class="detail-top-bar">
                    <button class="back-btn" data-action="back">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span class="detail-top-title">${this.item.title}</span>
                    <div class="detail-top-spacer"></div>
                </div>
                <div class="detail-content">
                    <div class="detail-hero">
                        <img src="${this.item.coverImage || this.item.coverUrl || ''}" 
                             alt="${this.item.title}" 
                             class="detail-cover"
                             onerror="this.style.display='none'">
                        <div class="detail-meta">
                            <h1 class="detail-title">${this.item.title}</h1>
                            <div class="detail-badges">
                                <span class="badge ${type}">${type === 'manga' ? 'Manga' : 'Anime'}</span>
                                ${this.source !== 'library' ? `<span class="badge secondary">${this.formatSource(this.item.source || this.source)}</span>` : ''}
                                ${this.item.episodes ? `<span class="badge secondary">${this.item.episodes} eps</span>` : ''}
                                ${this.item.chapters ? `<span class="badge secondary">${this.item.chapters} ch</span>` : ''}
                            </div>
                            ${genres.length > 0 ? `
                                <div class="detail-genres">
                                    ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
                                </div>
                            ` : ''}
                            <div class="detail-actions">
                                <button id="library-btn" class="btn ${this.isInLibrary ? 'btn-secondary' : 'btn-primary'}">
                                    ${this.isInLibrary ? 'In Library' : 'Add to Library'}
                                </button>
                            </div>
                        </div>
                    </div>
                    ${truncatedDesc ? `
                        <div class="detail-section">
                            <h3 class="detail-section-title">Synopsis</h3>
                            <p class="detail-description">${truncatedDesc}</p>
                        </div>
                    ` : ''}
                    <div class="detail-section">
                        <h3 class="detail-section-title">${type === 'manga' ? 'Chapters' : 'Episodes'}</h3>
                        <div id="content-list" class="content-list">
                            <div class="content-loading">
                                <div class="spinner"></div>
                                <span>Loading ${type === 'manga' ? 'chapters' : 'episodes'}...</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        // Back button
        document.querySelector('[data-action="back"]')?.addEventListener('click', () => {
            document.dispatchEvent(new Event('goBack'));
        });

        // Library button
        document.getElementById('library-btn')?.addEventListener('click', () => this.toggleLibrary());

        // Load episodes/chapters
        this.loadContent();
    }

    async loadContent() {
        const type = this.item.type || 'anime';
        const container = document.getElementById('content-list');
        if (!container) return;

        try {
            if (type === 'anime') {
                this.episodes = await SearchCoordinator.getAnimeEpisodes(
                    this.item.id, this.item.url, this.item.source
                );
                this.renderEpisodes(container);
            } else {
                this.chapters = await SearchCoordinator.getMangaChapters(
                    this.item.id, this.item.source, this.item.url
                );
                this.renderChapters(container);
            }
        } catch (error) {
            console.error('Failed to load content:', error);
            container.innerHTML = `<p class="content-error">Could not load ${type === 'manga' ? 'chapters' : 'episodes'}</p>`;
        }
    }

    renderEpisodes(container) {
        if (this.episodes.length === 0) {
            container.innerHTML = '<p class="content-empty">No episodes found</p>';
            return;
        }

        container.innerHTML = this.episodes.map(ep => `
            <div class="content-item" data-episode="${ep.episode || ep.number}" data-url="${ep.url || ''}">
                <div class="content-item-number">${ep.episode || ep.number}</div>
                <div class="content-item-info">
                    <span class="content-item-title">${ep.title || `Episode ${ep.episode || ep.number}`}</span>
                </div>
                <svg class="content-item-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
        `).join('');

        container.querySelectorAll('.content-item').forEach(el => {
            el.addEventListener('click', () => {
                const epNum = el.dataset.episode;
                const episode = this.episodes.find(e => String(e.episode || e.number) === epNum);
                if (episode) {
                    document.dispatchEvent(new CustomEvent('navigateToPlayer', {
                        detail: { libraryItem: this.item, episode }
                    }));
                }
            });
        });
    }

    renderChapters(container) {
        if (this.chapters.length === 0) {
            container.innerHTML = '<p class="content-empty">No chapters found</p>';
            return;
        }

        container.innerHTML = this.chapters.map(ch => `
            <div class="content-item" data-chapter="${ch.chapter || ch.id}" data-id="${ch.id}">
                <div class="content-item-number">${ch.chapter || '?'}</div>
                <div class="content-item-info">
                    <span class="content-item-title">${ch.title || `Chapter ${ch.chapter}`}</span>
                    ${ch.pages ? `<span class="content-item-meta">${ch.pages} pages</span>` : ''}
                </div>
                <svg class="content-item-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
        `).join('');

        container.querySelectorAll('.content-item').forEach(el => {
            el.addEventListener('click', () => {
                const chId = el.dataset.id;
                const chapter = this.chapters.find(c => c.id === chId);
                if (chapter) {
                    document.dispatchEvent(new CustomEvent('navigateToReader', {
                        detail: { libraryItem: this.item, chapter }
                    }));
                }
            });
        });
    }

    async toggleLibrary() {
        const btn = document.getElementById('library-btn');
        if (!btn) return;

        try {
            if (this.isInLibrary) {
                await db.removeFromLibrary(this.item.id);
                this.isInLibrary = false;
                btn.className = 'btn btn-primary';
                btn.textContent = 'Add to Library';
                showToast(`Removed "${this.item.title}"`, 'success');
            } else {
                const libraryItem = {
                    id: this.item.id,
                    title: this.item.title,
                    coverImage: this.item.coverImage || this.item.coverUrl || '',
                    description: this.item.description || '',
                    type: this.item.type || 'anime',
                    source: this.item.source || this.source,
                    url: this.item.url || '',
                    genres: this.item.genres || [],
                    episodes: this.item.episodes || null,
                    chapters: this.item.chapters || null
                };
                await db.addToLibrary(libraryItem);
                this.isInLibrary = true;
                btn.className = 'btn btn-secondary';
                btn.textContent = 'In Library';
                showToast(`Added "${this.item.title}" to library`, 'success');
            }
        } catch (error) {
            console.error('Library toggle error:', error);
            showToast('Failed to update library', 'error');
        }
    }

    formatSource(source) {
        const names = {
            hianime: 'HiAnime',
            aniwatch: 'AniWatch',
            mangadex: 'MangaDex',
            mangakatana: 'MangaKatana',
            library: 'Library'
        };
        return names[source] || source;
    }
}
