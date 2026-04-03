/**
 * Multi-Source Search Coordinator
 * Searches all scrapers in parallel, deduplicates, and merges results.
 * Priority order (first source wins on dedupe):
 * Anime: AniWatch
 * Manga: MangaKatana (direct HTML scraping) + MangaDex API
 */

import { AniWatchScraper } from './aniwatch.js';
import { MangaDexScraper } from './mangadex.js';
import { MangaKatanaScraper } from './mangakatana.js';

export class SearchCoordinator {
    /**
     * Search all sources for anime/manga
     */
    static async searchAll(query, contentType = 'both') {
        const anime = [];
        const manga = [];

        const promises = [];

        if (contentType === 'anime' || contentType === 'both') {
            promises.push(
                AniWatchScraper.search(query)
                    .then(r => ({ type: 'anime', source: 'aniwatch', results: r }))
                    .catch(e => { console.error('AniWatch failed:', e); return { type: 'anime', source: 'aniwatch', results: [] }; })
            );
        }

        if (contentType === 'manga' || contentType === 'both') {
            promises.push(
                MangaKatanaScraper.search(query)
                    .then(r => ({ type: 'manga', source: 'mangakatana', results: r }))
                    .catch(e => { console.error('MangaKatana failed:', e); return { type: 'manga', source: 'mangakatana', results: [] }; })
            );
            promises.push(
                MangaDexScraper.search(query)
                    .then(r => ({ type: 'manga', source: 'mangadex', results: r }))
                    .catch(e => { console.error('MangaDex failed:', e); return { type: 'manga', source: 'mangadex', results: [] }; })
            );
        }

        const settled = await Promise.allSettled(promises);

        // Collect results — primary sources first for dedup priority
        settled.forEach(s => {
            if (s.status !== 'fulfilled' || !s.value) return;
            const { type, results } = s.value;
            if (type === 'anime') anime.push(...results);
            else manga.push(...results);
        });

        // Deduplicate each category
        const dedupedAnime = this._deduplicate(anime);
        const dedupedManga = this._deduplicate(manga);

        return {
            anime: dedupedAnime,
            manga: dedupedManga,
            all: [
                ...dedupedAnime.map(r => ({ ...r, type: 'anime' })),
                ...dedupedManga.map(r => ({ ...r, type: 'manga' }))
            ]
        };
    }

    static async searchAnime(query) {
        try {
            return await AniWatchScraper.search(query);
        } catch (error) {
            console.error('Anime search error:', error);
            return [];
        }
    }

    static async searchManga(query) {
        try {
            const [katana, mdex] = await Promise.allSettled([
                MangaKatanaScraper.search(query),
                MangaDexScraper.search(query)
            ]);
            const results = [
                ...(katana.status === 'fulfilled' ? katana.value : []),
                ...(mdex.status === 'fulfilled' ? mdex.value : [])
            ];
            return this._deduplicate(results);
        } catch (error) {
            console.error('Manga search error:', error);
            return [];
        }
    }

    static async getAnimeEpisodes(animeId, animeUrl, source = 'aniwatch', animeTitle = '') {
        const fromId = this._extractAniwatchSlug(animeId);
        const fromUrl = this._extractAniwatchSlug(animeUrl);
        const targetSlug = fromId || fromUrl;

        try {
            if (targetSlug) {
                return await AniWatchScraper.getEpisodes(targetSlug);
            }

            if (animeTitle) {
                const searchResults = await AniWatchScraper.search(animeTitle);
                const bestMatch = searchResults.find((item) => this._titlesMatch(item?.title, animeTitle)) || searchResults[0];
                if (bestMatch?.id) {
                    return await AniWatchScraper.getEpisodes(bestMatch.id);
                }
            }

            return await AniWatchScraper.getEpisodes(animeId || animeUrl);
        } catch (error) {
            console.error('Failed to get episodes:', error);
            return [];
        }
    }

    static async getMangaChapters(mangaId, source = 'mangakatana', mangaUrl = '') {
        const normalizedSource = String(source || '').toLowerCase();
        const katanaTarget = mangaUrl || mangaId;
        try {
            if (normalizedSource === 'mangakatana') {
                return await MangaKatanaScraper.getChapters(katanaTarget);
            }
            return await MangaDexScraper.getChapters(mangaId);
        } catch (error) {
            console.error('Failed to get chapters from', source, ':', error);
            // Fallback to secondary source
            try {
                if (normalizedSource === 'mangakatana') {
                    return await MangaDexScraper.getChapters(mangaId);
                }
                return await MangaKatanaScraper.getChapters(katanaTarget);
            } catch (_) {}
            return [];
        }
    }

    static async getChapterPages(chapterId, source = 'mangakatana') {
        const normalizedSource = String(source || '').toLowerCase();
        const normalizePages = (pages) => (pages || [])
            .map((page) => (typeof page === 'string' ? page : page?.url))
            .filter(Boolean);

        try {
            if (normalizedSource === 'mangakatana') {
                return normalizePages(await MangaKatanaScraper.getPages(chapterId));
            }
            return normalizePages(await MangaDexScraper.getPages(chapterId));
        } catch (error) {
            console.error('Failed to get pages from', source, ':', error);
            try {
                if (normalizedSource === 'mangakatana') {
                    return normalizePages(await MangaDexScraper.getPages(chapterId));
                }
                return normalizePages(await MangaKatanaScraper.getPages(chapterId));
            } catch (_) {}
            return [];
        }
    }

    static async getAnimeStreamUrl(episodeOrId, source = 'aniwatch', audioType = null) {
        try {
            return await AniWatchScraper.getStreamUrl(episodeOrId, audioType);
        } catch (error) {
            console.error('Failed to get stream URL:', error);
            return null;
        }
    }

    /** Remove duplicate titles — first occurrence wins (primary sources added first) */
    static _deduplicate(results) {
        const seen = new Map();
        return results.filter(item => {
            if (!item || !item.title) return false;
            const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!key) return false;
            if (seen.has(key)) return false;
            seen.set(key, true);
            return true;
        });
    }

    /** Fuzzy title comparison */
    static _titlesMatch(a, b) {
        if (!a || !b) return false;
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalize(a) === normalize(b);
    }

    static _extractAniwatchSlug(value) {
        if (!value) return '';
        let text = String(value).trim();
        if (!text) return '';

        if (/^https?:\/\//i.test(text)) {
            try {
                const parsed = new URL(text);
                text = parsed.pathname || '';
            } catch (_) {
                return '';
            }
        }

        text = text.replace(/^\/+/, '');
        text = text.replace(/^watch\//, '');
        text = text.split('?')[0].split('#')[0].replace(/\/+$/, '');
        if (!text) return '';
        if (/^[a-z0-9-]+-\d+$/i.test(text)) return text;
        const slugMatch = text.match(/([a-z0-9-]+-\d+)$/i);
        return slugMatch ? slugMatch[1] : '';
    }
}
