/**
 * Multi-Source Search Coordinator
 * Searches all scrapers in parallel, deduplicates, and merges results.
 * Anime: Jikan (MAL metadata) + AniWatch (direct scraping via mirrors)
 * Manga: MangaDex API + MangaKatana (direct HTML scraping)
 */

import { AniWatchScraper } from './aniwatch.js';
import { MangaDexScraper } from './mangadex.js';
import { MangaKatanaScraper } from './mangakatana.js';
import { JikanScraper } from './jikan.js';

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
                JikanScraper.search(query)
                    .then(r => ({ type: 'anime', source: 'jikan', results: r }))
                    .catch(e => { console.error('Jikan failed:', e); return { type: 'anime', source: 'jikan', results: [] }; })
            );
            promises.push(
                AniWatchScraper.search(query)
                    .then(r => ({ type: 'anime', source: 'aniwatch', results: r }))
                    .catch(e => { console.error('AniWatch failed:', e); return { type: 'anime', source: 'aniwatch', results: [] }; })
            );
        }

        if (contentType === 'manga' || contentType === 'both') {
            promises.push(
                MangaDexScraper.search(query)
                    .then(r => ({ type: 'manga', source: 'mangadex', results: r }))
                    .catch(e => { console.error('MangaDex failed:', e); return { type: 'manga', source: 'mangadex', results: [] }; })
            );
            promises.push(
                MangaKatanaScraper.search(query)
                    .then(r => ({ type: 'manga', source: 'mangakatana', results: r }))
                    .catch(e => { console.error('MangaKatana failed:', e); return { type: 'manga', source: 'mangakatana', results: [] }; })
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
            const [jikan, aniwatch] = await Promise.allSettled([
                JikanScraper.search(query),
                AniWatchScraper.search(query)
            ]);
            const results = [
                ...(jikan.status === 'fulfilled' ? jikan.value : []),
                ...(aniwatch.status === 'fulfilled' ? aniwatch.value : [])
            ];
            return this._deduplicate(results);
        } catch (error) {
            console.error('Anime search error:', error);
            return [];
        }
    }

    static async searchManga(query) {
        try {
            const [mdex, katana] = await Promise.allSettled([
                MangaDexScraper.search(query),
                MangaKatanaScraper.search(query)
            ]);
            const results = [
                ...(mdex.status === 'fulfilled' ? mdex.value : []),
                ...(katana.status === 'fulfilled' ? katana.value : [])
            ];
            return this._deduplicate(results);
        } catch (error) {
            console.error('Manga search error:', error);
            return [];
        }
    }

    static async getAnimeEpisodes(animeId, animeUrl, source = 'aniwatch') {
        try {
            return await AniWatchScraper.getEpisodes(animeId || animeUrl);
        } catch (error) {
            console.error('Failed to get episodes:', error);
            return [];
        }
    }

    static async getMangaChapters(mangaId, source = 'mangadex') {
        try {
            if (source === 'mangakatana') {
                return await MangaKatanaScraper.getChapters(mangaId);
            }
            return await MangaDexScraper.getChapters(mangaId);
        } catch (error) {
            console.error('Failed to get chapters from', source, ':', error);
            // Fallback
            try {
                if (source === 'mangadex') return await MangaKatanaScraper.getChapters(mangaId);
            } catch (_) {}
            return [];
        }
    }

    static async getChapterPages(chapterId, source = 'mangadex') {
        try {
            if (source === 'mangakatana') {
                return await MangaKatanaScraper.getPages(chapterId);
            }
            return await MangaDexScraper.getPages(chapterId);
        } catch (error) {
            console.error('Failed to get pages:', error);
            return [];
        }
    }

    static async getAnimeStreamUrl(episodeUrl, source = 'aniwatch') {
        try {
            return await AniWatchScraper.getStreamUrl(episodeUrl);
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
}
