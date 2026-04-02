/**
 * HiAnime Scraper - Delegates to AniWatch
 * HiAnime.to is currently down, so this wraps the AniWatch scraper
 * and re-labels results as 'hianime' source for backward compatibility.
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
            const episodes = await AniWatchScraper.getEpisodes(animeId);
            return episodes.map(ep => ({
                ...ep,
                episode: ep.number
            }));
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
            return {
                ...details,
                source: 'hianime',
                coverImage: details.coverUrl || ''
            };
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
