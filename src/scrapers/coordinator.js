/**
 * Multi-Source Search Coordinator
 * Searches all scrapers simultaneously and merges results.
 * Anime: Jikan (MAL metadata) + AniWatch (direct HTML scraping of aniwatch.to)
 * Manga: MangaDex API (primary) + MangaKatana (direct HTML scraping)
 */

import { HiAnimeScraper } from './hianime.js';
import { AniWatchScraper } from './aniwatch.js';
import { MangaDexScraper } from './mangadex.js';
import { MangaKatanaScraper } from './mangakatana.js';
import { JikanScraper } from './jikan.js';

export class SearchCoordinator {
    /**
     * Search all sources for anime/manga
     */
    static async searchAll(query, contentType = 'both') {
        const results = {
            anime: [],
            manga: [],
            all: []
        };

        const promises = [];

        if (contentType === 'anime' || contentType === 'both') {
            // Jikan (MyAnimeList) - most reliable anime metadata
            promises.push(
                JikanScraper.search(query)
                    .then(animeResults => {
                        results.anime.push(...animeResults);
                        results.all.push(...animeResults.map(r => ({ ...r, type: 'anime' })));
                    })
                    .catch(error => console.error('Jikan search failed:', error))
            );

            // HiAnime (delegates to AniWatch direct scraping)
            promises.push(
                HiAnimeScraper.search(query)
                    .then(animeResults => {
                        // Deduplicate against Jikan results
                        const newResults = animeResults.filter(r =>
                            !results.anime.some(a => this._titlesMatch(a.title, r.title))
                        );
                        results.anime.push(...newResults);
                        results.all.push(...newResults.map(r => ({ ...r, type: 'anime' })));
                    })
                    .catch(error => console.error('HiAnime search failed:', error))
            );
        }

        if (contentType === 'manga' || contentType === 'both') {
            promises.push(
                MangaDexScraper.search(query)
                    .then(mangaResults => {
                        results.manga.push(...mangaResults);
                        results.all.push(...mangaResults.map(r => ({ ...r, type: 'manga' })));
                    })
                    .catch(error => console.error('MangaDex search failed:', error))
            );

            promises.push(
                MangaKatanaScraper.search(query)
                    .then(mangaResults => {
                        const newResults = mangaResults.filter(r =>
                            !results.manga.some(m => this._titlesMatch(m.title, r.title))
                        );
                        results.manga.push(...newResults);
                        results.all.push(...newResults.map(r => ({ ...r, type: 'manga' })));
                    })
                    .catch(error => console.error('MangaKatana search failed:', error))
            );
        }

        await Promise.allSettled(promises);
        return results;
    }

    /**
     * Search just anime (Jikan for metadata, AniWatch for streaming)
     */
    static async searchAnime(query) {
        try {
            const [jikanResults, hianimeResults] = await Promise.allSettled([
                JikanScraper.search(query),
                HiAnimeScraper.search(query)
            ]).then(settled => [
                settled[0].status === 'fulfilled' ? settled[0].value : [],
                settled[1].status === 'fulfilled' ? settled[1].value : []
            ]);

            const results = [...jikanResults];

            // Add HiAnime results that aren't duplicates
            const uniqueHianime = hianimeResults.filter(h =>
                !results.some(r => this._titlesMatch(r.title, h.title))
            );
            results.push(...uniqueHianime);

            return results;
        } catch (error) {
            console.error('Anime search error:', error);
            return [];
        }
    }

    /**
     * Search just manga
     */
    static async searchManga(query) {
        const results = [];

        try {
            const [mangaDexResults, katanaResults] = await Promise.allSettled([
                MangaDexScraper.search(query),
                MangaKatanaScraper.search(query)
            ]).then(settled => [
                settled[0].status === 'fulfilled' ? settled[0].value : [],
                settled[1].status === 'fulfilled' ? settled[1].value : []
            ]);

            results.push(...mangaDexResults);

            const newResults = katanaResults.filter(r =>
                !results.some(m => this._titlesMatch(m.title, r.title))
            );
            results.push(...newResults);
        } catch (error) {
            console.error('Manga search error:', error);
        }

        return results;
    }

    /**
     * Get episodes for an anime from specific source
     */
    static async getAnimeEpisodes(animeId, animeUrl, source = 'hianime') {
        try {
            if (source === 'aniwatch') {
                return await AniWatchScraper.getEpisodes(animeId);
            }
            // Default to HiAnime API
            return await HiAnimeScraper.getEpisodes(animeId || animeUrl);
        } catch (error) {
            console.error('Failed to get episodes from', source, ':', error);
            // Try fallback
            try {
                if (source === 'aniwatch') {
                    return await HiAnimeScraper.getEpisodes(animeId || animeUrl);
                } else {
                    return await AniWatchScraper.getEpisodes(animeId);
                }
            } catch (fallbackError) {
                console.error('Fallback also failed:', fallbackError);
                return [];
            }
        }
    }

    /**
     * Get chapters for manga from specific source
     */
    static async getMangaChapters(mangaId, source = 'mangadex') {
        try {
            if (source === 'mangadex') {
                return await MangaDexScraper.getChapters(mangaId);
            } else if (source === 'mangakatana') {
                return await MangaKatanaScraper.getChapters(mangaId);
            }
        } catch (error) {
            console.error('Failed to get chapters:', error);
            // Try fallback
            try {
                if (source === 'mangadex') {
                    return await MangaKatanaScraper.getChapters(mangaId);
                }
            } catch (_) {}
            return [];
        }
    }

    /**
     * Get pages for a chapter
     */
    static async getChapterPages(chapterId, source = 'mangadex') {
        try {
            if (source === 'mangadex') {
                return await MangaDexScraper.getPages(chapterId);
            } else if (source === 'mangakatana') {
                return await MangaKatanaScraper.getPages(chapterId);
            }
        } catch (error) {
            console.error('Failed to get pages:', error);
            return [];
        }
    }

    /**
     * Get streaming URL for anime episode
     */
    static async getAnimeStreamUrl(episodeUrl, source = 'hianime') {
        try {
            if (source === 'aniwatch') {
                return await AniWatchScraper.getStreamUrl(episodeUrl);
            }
            return await HiAnimeScraper.getStreamUrl(episodeUrl);
        } catch (error) {
            console.error('Failed to get stream URL:', error);
            // Try fallback
            try {
                return await AniWatchScraper.getStreamUrl(episodeUrl);
            } catch (_) {}
            return null;
        }
    }

    /** Fuzzy title comparison for deduplication */
    static _titlesMatch(a, b) {
        if (!a || !b) return false;
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalize(a) === normalize(b);
    }
}
