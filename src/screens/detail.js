/**
 * Detail Screen - Shows anime/manga metadata and episodes/chapters
 */

import { SearchCoordinator } from '../scrapers/coordinator.js';
import { JikanScraper } from '../scrapers/jikan.js';
import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';

export class DetailScreen {
    constructor(item, source) {
        this.item = item;
        this.source = source;
        this.episodes = [];
        this.chapters = [];
        this.isInLibrary = false;
        this.isRecommended = false;
        this.isLoadingContent = false;
        this._downloadBtnState = 'idle';
    }

    async render() {
        // Check if already in library
        try {
            const existing = await db.getLibraryItem(this.item.id);
            this.isInLibrary = !!existing;
        } catch (e) {
            this.isInLibrary = false;
        }

        // Check if already recommended
        try {
            this.isRecommended = await db.isRecommended(this.item.id);
        } catch (e) {
            this.isRecommended = false;
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
                                ${this.item.score ? `<span class="badge score-badge">★ ${this.item.score}</span>` : ''}
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
                                <button id="recommend-btn" class="btn ${this.isRecommended ? 'btn-recommend-active' : 'btn-secondary'}">
                                    ${this.isRecommended ? '★ Recommended' : '☆ Recommend'}
                                </button>
                                <button id="download-btn" class="btn btn-secondary">
                                    Download
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
                    ${type === 'anime' ? `
                        <div id="relations-section" class="detail-section" style="display:none">
                            <h3 class="detail-section-title">Seasons & Related</h3>
                            <div id="relations-list" class="relations-list"></div>
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
        document.getElementById('download-btn')?.addEventListener('click', () => {
            this.openDownloadPicker();
        });

        // Recommend button
        document.getElementById('recommend-btn')?.addEventListener('click', () => this.toggleRecommend());

        // Load episodes/chapters
        this.loadContent();

        // Load relations for anime (non-blocking)
        if ((this.item.type || 'anime') === 'anime') {
            this._loadRelations();
        }
    }

    async loadContent() {
        const type = this.item.type || 'anime';
        const container = document.getElementById('content-list');
        if (!container) return;

        try {
            if (type === 'anime') {
                this.episodes = await SearchCoordinator.getAnimeEpisodes(
                    this.item.id, this.item.url, this.item.source, this.item.title, this.item.episodes
                );
                this.episodes = this.episodes.map((ep) => ({
                    ...ep,
                    source: this.item.source || this.source || 'aniwatch'
                }));
                this.renderEpisodes(container);
            } else {
                this.chapters = await SearchCoordinator.getMangaChapters(
                    this.item.id, this.item.source, this.item.url, this.item.title,
                    this.item.titleEnglish || ''
                );
                this.chapters = this.chapters.map((ch) => ({
                    ...ch,
                    source: ch.source || this.item.source || this.source || 'mangakatana'
                }));
                this.renderChapters(container);
            }
        } catch (error) {
            console.error('Failed to load content:', error);
            container.innerHTML = `<p class="content-error">Could not load ${type === 'manga' ? 'chapters' : 'episodes'}</p>`;
        }
    }

    async _loadRelations() {
        const section = document.getElementById('relations-section');
        const list = document.getElementById('relations-list');
        if (!section || !list) return;

        // Extract MAL ID
        const malId = this.item.malId || (this.item.id?.startsWith('mal-') ? parseInt(this.item.id.replace('mal-', '')) : null);
        if (!malId) {
            // Try searching Jikan by title to get malId
            try {
                const results = await JikanScraper.search(this.item.title);
                if (results.length > 0) {
                    // Smart match: don't blindly pick first result
                    const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const target = normalize(this.item.title);
                    const match = results.find(r => normalize(r.title) === target)
                        || results.find(r => normalize(r.title).includes(target) || target.includes(normalize(r.title)));
                    if (match?.malId) {
                        this.item.malId = match.malId;
                        return this._loadRelationsForMalId(match.malId, section, list);
                    }
                }
            } catch (e) { /* no relations */ }
            return;
        }
        return this._loadRelationsForMalId(malId, section, list);
    }

    async _loadRelationsForMalId(malId, section, list) {
        try {
            const relations = await JikanScraper.getRelations(malId);
            if (!relations.length) return;

            // Order: Prequel first, then current, then sequel, then others
            const ORDER = { 'Prequel': 0, 'Parent story': 1, 'Side story': 3, 'Sequel': 4, 'Alternative version': 5, 'Spin-off': 6, 'Summary': 7 };
            relations.sort((a, b) => (ORDER[a.relation] ?? 99) - (ORDER[b.relation] ?? 99));

            // Fetch cover images for first few relations (with Jikan rate limit awareness)
            const enriched = [];
            for (const rel of relations.slice(0, 6)) {
                try {
                    // Small delay for Jikan rate limit (3 req/s)
                    if (enriched.length > 0) await new Promise(r => setTimeout(r, 350));
                    const details = await JikanScraper.getBasicById(rel.malId);
                    if (details) {
                        enriched.push({ ...rel, ...details, relation: rel.relation });
                    } else {
                        enriched.push(rel);
                    }
                } catch (e) {
                    enriched.push(rel);
                }
            }
            // Add remaining without enrichment
            for (const rel of relations.slice(6)) {
                enriched.push(rel);
            }

            if (!enriched.length) return;

            const RELATION_LABELS = {
                'Prequel': '⏮ Prequel',
                'Sequel': '⏭ Sequel',
                'Parent story': '📖 Main Story',
                'Side story': '📎 Side Story',
                'Alternative version': '🔄 Alt Version',
                'Spin-off': '🌀 Spin-off',
                'Summary': '📋 Summary'
            };

            list.innerHTML = enriched.map(rel => `
                <div class="relation-card" data-mal-id="${rel.malId}">
                    ${rel.coverImage ? `<img class="relation-cover" src="${rel.coverImage}" alt="${rel.title}" onerror="this.style.display='none'">` : 
                        '<div class="relation-cover-placeholder"></div>'}
                    <div class="relation-info">
                        <span class="relation-type">${RELATION_LABELS[rel.relation] || rel.relation}</span>
                        <span class="relation-title">${rel.title}</span>
                        ${rel.episodes ? `<span class="relation-meta">${rel.episodes} eps</span>` : ''}
                        ${rel.score ? `<span class="relation-meta">★ ${rel.score}</span>` : ''}
                    </div>
                </div>
            `).join('');

            section.style.display = '';

            // Click handlers — navigate to the related anime
            list.querySelectorAll('.relation-card').forEach(card => {
                card.addEventListener('click', () => {
                    const mId = parseInt(card.dataset.malId);
                    const rel = enriched.find(r => r.malId === mId);
                    if (!rel) return;
                    document.dispatchEvent(new CustomEvent('navigateToDetail', {
                        detail: {
                            item: {
                                id: rel.id || `mal-${mId}`,
                                malId: mId,
                                title: rel.title,
                                coverImage: rel.coverImage || '',
                                description: rel.description || '',
                                type: 'anime',
                                source: 'jikan',
                                url: rel.url || '',
                                genres: rel.genres || [],
                                episodes: rel.episodes || null,
                                score: rel.score || null
                            },
                            source: 'jikan'
                        }
                    }));
                });
            });
        } catch (error) {
            console.error('Failed to load relations:', error);
        }
    }

    renderEpisodes(container) {
        if (this.episodes.length === 0) {
            container.innerHTML = '<p class="content-empty">No episodes found</p>';
            return;
        }

        // Check which episodes are downloaded
        this._markDownloadedEpisodes(container);

        // Audio availability banner (populated async)
        container.innerHTML = `
            <div id="audio-type-banner" class="audio-type-banner" style="display:none;"></div>
        ` + this.episodes.map(ep => `
            <div class="content-item" data-episode="${ep.episode || ep.number}" data-url="${ep.url || ''}">
                <div class="content-item-number">${ep.episode || ep.number}</div>
                <div class="content-item-info">
                    <span class="content-item-title">${ep.title || `Episode ${ep.episode || ep.number}`}</span>
                    <span class="content-item-meta ep-dl-badge" data-ep-num="${ep.episode || ep.number}"></span>
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
                        detail: {
                            libraryItem: this.item,
                            episode: {
                                ...episode,
                                source: episode.source || this.item.source || this.source || 'aniwatch'
                            },
                            allEpisodes: this.episodes
                        }
                    }));
                }
            });
        });

        // Async: check audio availability from first episode
        this._checkAudioAvailability();
    }

    async _checkAudioAvailability() {
        try {
            const firstEp = this.episodes[0];
            if (!firstEp) return;
            const epId = firstEp.episodeId || firstEp.id || firstEp.url;
            const source = firstEp.source || this.item.source || this.source || 'aniwatch';
            // Quick stream check — we only need availableTypes from the response
            const streamData = await SearchCoordinator.getAnimeStreamUrl(epId, source, null);
            const types = streamData?.availableTypes || [];
            const banner = document.getElementById('audio-type-banner');
            if (!banner || types.length === 0) return;

            const hasSub = types.includes('sub') || types.includes('raw');
            const hasDub = types.includes('dub');
            let badges = '';
            if (hasSub) badges += '<span class="audio-badge audio-badge-sub">SUB</span>';
            if (hasDub) badges += '<span class="audio-badge audio-badge-dub">DUB</span>';
            if (badges) {
                banner.innerHTML = badges;
                banner.style.display = '';
            }
        } catch {
            // Non-critical — silently fail
        }
    }

    renderChapters(container) {
        if (this.chapters.length === 0) {
            container.innerHTML = '<p class="content-empty">No chapters found</p>';
            return;
        }

        container.innerHTML = this.chapters.map(ch => {
            const chNum = ch.chapter !== null && ch.chapter !== undefined ? ch.chapter : '?';
            return `
            <div class="content-item" data-chapter="${ch.chapter ?? ch.id}" data-id="${ch.id}">
                <div class="content-item-number">${chNum}</div>
                <div class="content-item-info">
                    <span class="content-item-title">${ch.title || `Chapter ${chNum}`}</span>
                    ${ch.pages ? `<span class="content-item-meta">${ch.pages} pages</span>` : ''}
                </div>
                <svg class="content-item-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>`;
        }).join('');

        container.querySelectorAll('.content-item').forEach(el => {
            el.addEventListener('click', () => {
                const chId = el.dataset.id;
                const chapter = this.chapters.find(c => c.id === chId);
                if (chapter) {
                    document.dispatchEvent(new CustomEvent('navigateToReader', {
                        detail: {
                            libraryItem: this.item,
                            chapter: {
                                ...chapter,
                                source: chapter.source || this.item.source || this.source || 'mangakatana'
                            },
                            allChapters: this.chapters.map(ch => ({
                                ...ch,
                                source: ch.source || this.item.source || this.source || 'mangakatana'
                            }))
                        }
                    }));
                }
            });
        });
    }

    /** Async badge: marks episodes that have been downloaded for offline use */
    async _markDownloadedEpisodes() {
        try {
            const downloads = await db.getDownloads();
            const completed = downloads.filter(d =>
                d.libraryId === this.item.id && d.status === 'completed'
            );
            // Wait a tick for DOM to be rendered
            setTimeout(() => {
                for (const dl of completed) {
                    const epMatch = (dl.episodeOrChapterId || '').match(/^ep-(\d+)/);
                    if (epMatch) {
                        const badge = document.querySelector(`.ep-dl-badge[data-ep-num="${epMatch[1]}"]`);
                        if (badge) badge.innerHTML = '<span style="color:var(--success);font-size:10px;">✓ Offline</span>';
                    }
                }
            }, 50);
        } catch (_) {}
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
                    titleEnglish: this.item.titleEnglish || '',
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

    async toggleRecommend() {
        const btn = document.getElementById('recommend-btn');
        if (!btn) return;

        try {
            if (this.isRecommended) {
                await db.removeRecommendation(this.item.id);
                this.isRecommended = false;
                btn.className = 'btn btn-secondary';
                btn.textContent = '☆ Recommend';
                showToast(`Removed recommendation`, 'success');
            } else {
                const recItem = {
                    id: this.item.id,
                    title: this.item.title,
                    titleEnglish: this.item.titleEnglish || '',
                    coverImage: this.item.coverImage || this.item.coverUrl || '',
                    description: this.item.description || '',
                    type: this.item.type || 'anime',
                    source: this.item.source || this.source,
                    url: this.item.url || '',
                    genres: this.item.genres || [],
                    episodes: this.item.episodes || null,
                    chapters: this.item.chapters || null,
                    score: this.item.score || null
                };
                await db.addRecommendation(recItem);
                this.isRecommended = true;
                btn.className = 'btn btn-recommend-active';
                btn.textContent = '★ Recommended';
                showToast(`Recommended "${this.item.title}"`, 'success');
            }
        } catch (error) {
            console.error('Recommend toggle error:', error);
            showToast('Failed to update recommendation', 'error');
        }
    }

    async openDownloadPicker() {
        const type = this.item.type || 'anime';
        const list = type === 'anime' ? this.episodes : this.chapters;
        if (!list || list.length === 0) {
            showToast(`No ${type === 'anime' ? 'episodes' : 'chapters'} available to download`, 'error');
            return;
        }

        const dialog = document.createElement('div');
        dialog.className = 'delete-dialog';
        dialog.innerHTML = `
            <div class="dialog-content detail-download-dialog">
                <p>Choose ${type === 'anime' ? 'episode' : 'chapter'} to download</p>
                <div class="detail-download-list">
                    ${list.slice(0, 100).map((entry) => {
                        const label = type === 'anime'
                            ? `Episode ${entry.number ?? entry.episode ?? '?'}`
                            : `Chapter ${entry.chapter ?? '?'}`;
                        const subtitle = this._esc(entry.title || '');
                        const id = this._esc(entry.id || entry.url || '');
                        return `
                            <button class="detail-download-item" data-entry-id="${id}">
                                <span class="detail-download-item-title">${label}</span>
                                ${subtitle ? `<span class="detail-download-item-sub">${subtitle}</span>` : ''}
                            </button>
                        `;
                    }).join('')}
                </div>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                </div>
            </div>
        `;

        const close = () => dialog.remove();
        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
        dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

        dialog.querySelectorAll('.detail-download-item').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const entryId = btn.getAttribute('data-entry-id');
                const selected = list.find((entry) => String(entry.id || entry.url || '') === entryId);
                if (!selected) return;
                await this.queueDownload(selected, type);
                close();
            });
        });

        document.body.appendChild(dialog);
    }

    async queueDownload(entry, type) {
        const downloadBtn = document.getElementById('download-btn');
        if (this._downloadBtnState === 'busy') return;
        this._downloadBtnState = 'busy';
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Queuing...';
        }

        try {
            const source = this.item.source || this.source || (type === 'anime' ? 'aniwatch' : 'mangakatana');
            const itemId = this.item.id;
            const token = type === 'anime'
                ? `ep-${entry.number ?? entry.episode ?? '?'}`
                : `ch-${entry.chapter ?? '?'}`;
            const readable = entry.title || token;
            const entryId = entry.id || entry.url || token;
            const localPath = entry.url || entry.id || '';

            // Ensure item exists in library for Downloads linkage
            const existing = await db.getLibraryItem(itemId);
            if (!existing) {
                await db.addToLibrary({
                    id: this.item.id,
                    title: this.item.title,
                    titleEnglish: this.item.titleEnglish || '',
                    coverImage: this.item.coverImage || this.item.coverUrl || '',
                    description: this.item.description || '',
                    type: this.item.type || type,
                    source,
                    url: this.item.url || '',
                    genres: this.item.genres || [],
                    episodes: this.item.episodes || null,
                    chapters: this.item.chapters || null
                });
                this.isInLibrary = true;
                const libraryBtn = document.getElementById('library-btn');
                if (libraryBtn) {
                    libraryBtn.className = 'btn btn-secondary';
                    libraryBtn.textContent = 'In Library';
                }
            }

            const queued = await db.addDownload(itemId, `${token} - ${readable}`, localPath, 0);
            await db.updateDownload(queued.id, {
                status: 'queued',
                progress: 0,
                source,
                sourceId: entryId,
                itemType: type
            });
            showToast('Download queued', 'success');
        } catch (error) {
            console.error('Failed to queue download:', error);
            showToast('Failed to queue download', 'error');
        } finally {
            this._downloadBtnState = 'idle';
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
            }
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

    _esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
}
