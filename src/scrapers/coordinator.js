/**
 * Multi-Source Search Coordinator
 * Searches all scrapers simultaneously and merges results
 */

import { HiAnimeScraper } from './hianime.js';
import { MangaDexScraper } from './mangadex.js';
import { MangaKatanaScraper } from './mangakatana.js';

export class SearchCoordinator {
    /**
     * Search all sources for anime/manga
     * Returns results from all sources that succeed
     */
    static async searchAll(query, contentType = 'both') {
        const results = {
            anime: [],
            manga: [],
            all: []
        };

        const promises = [];

        // Search anime sources
        if (contentType === 'anime' || contentType === 'both') {
            promises.push(
                HiAnimeScraper.search(query)
                    .then(animeResults => {
                        results.anime.push(...animeResults);
                        results.all.push(...animeResults.map(r => ({ ...r, type: 'anime' })));
                    })
                    .catch(error => console.error('HiAnime search failed:', error))
            );
        }

        // Search manga sources
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
                        // Avoid duplicates - check if title already exists
                        const newResults = mangaResults.filter(r => 
                            !results.manga.some(m => m.title.toLowerCase() === r.title.toLowerCase())
                        );
                        results.manga.push(...newResults);
                        results.all.push(...newResults.map(r => ({ ...r, type: 'manga' })));
                    })
                    .catch(error => console.error('MangaKatana search failed:', error))
            );
        }

        // Wait for all searches to complete
        await Promise.allSettled(promises);

        return results;
    }

    /**
     * Search just anime
     */
    static async searchAnime(query) {
        try {
            return await HiAnimeScraper.search(query);
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
            // Primary source
            const mangaDexResults = await MangaDexScraper.search(query);
            results.push(...mangaDexResults);

            // Fallback source (only if few results)
            if (mangaDexResults.length < 5) {
                const katanaResults = await MangaKatanaScraper.search(query);
                const newResults = katanaResults.filter(r => 
                    !results.some(m => m.title.toLowerCase() === r.title.toLowerCase())
                );
                results.push(...newResults);
            }
        } catch (error) {
            console.error('Manga search error:', error);
        }

        return results;
    }

    /**
     * Get episodes for an anime from specific source
     */
    static async getAnimeEpisodes(animeId, animeUrl) {
        try {
            return await HiAnimeScraper.getEpisodes(animeUrl);
        } catch (error) {
            console.error('Failed to get episodes:', error);
            return [];
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
    static async getAnimeStreamUrl(episodeUrl) {
        try {
            return await HiAnimeScraper.getStreamUrl(episodeUrl);
        } catch (error) {
            console.error('Failed to get stream URL:', error);
            return null;
        }
    }
}
