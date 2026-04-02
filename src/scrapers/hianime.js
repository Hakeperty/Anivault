/**
 * HiAnime Scraper - Delegates to AniWatch
 * hianime.to / hianime.nz are shut down. This wraps AniWatch
 * and re-labels results for backward compatibility.
 */

import { AniWatchScraper } from './aniwatch.js';

export class HiAnimeScraper {
    static async search(query) {
        try {
            const results = await AniWatchScraper.search(query);
            return results.map(r => ({
                ...r,
                source: 'hianime',
                coverImage: r.coverUrl || r.coverImage || ''
            }));
        } catch (error) {
            console.error('HiAnime search error:', error);
            return [];
        }
    }

    static async getEpisodes(animeId) {
        try {
            return await AniWatchScraper.getEpisodes(animeId);
        } catch (error) {
            console.error('HiAnime getEpisodes error:', error);
            return [];
        }
    }

    static async getStreamUrl(episodeId) {
        try {
            return await AniWatchScraper.getStreamUrl(episodeId);
        } catch (error) {
            console.error('HiAnime getStreamUrl error:', error);
            return null;
        }
    }

    static async getDetails(animeId) {
        try {
            const details = await AniWatchScraper.getDetails(animeId);
            return { ...details, source: 'hianime' };
        } catch (error) {
            console.error('HiAnime getDetails error:', error);
            return {
                id: animeId, title: animeId, description: '', genres: [],
                coverImage: '', source: 'hianime', type: 'anime',
                rating: 'N/A', status: 'Unknown'
            };
        }
    }
}
