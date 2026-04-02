/**
 * Jikan Scraper (MyAnimeList API)
 * Uses the free Jikan REST API v4 - reliable anime search with CORS support.
 * This is the most reliable anime source since it's a proper public API.
 */

import { http } from '../utils/http.js';

const JIKAN_API = 'https://api.jikan.moe/v4';

export class JikanScraper {
    /**
     * Search for anime on MyAnimeList via Jikan
     */
    static async search(query) {
        try {
            const url = `${JIKAN_API}/anime?q=${encodeURIComponent(query)}&limit=15&sfw=true`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('Jikan search error:', error);
            return [];
        }
    }

    /**
     * Parse search results from Jikan API
     */
    static parseSearchResults(data) {
        const results = [];

        (data.data || []).forEach(anime => {
            try {
                results.push({
                    id: `mal-${anime.mal_id}`,
                    malId: anime.mal_id,
                    title: anime.title || anime.title_english || 'Unknown',
                    coverImage: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '',
                    description: anime.synopsis || '',
                    type: 'anime',
                    source: 'jikan',
                    url: anime.url || '',
                    episodes: anime.episodes || null,
                    genres: (anime.genres || []).map(g => g.name).filter(Boolean),
                    score: anime.score || null,
                    status: anime.status || 'Unknown',
                    year: anime.year || (anime.aired?.prop?.from?.year) || null
                });
            } catch (e) {
                console.debug('Jikan parse error:', e);
            }
        });

        return results;
    }

    /**
     * Get anime details from Jikan
     */
    static async getDetails(malId) {
        try {
            const url = `${JIKAN_API}/anime/${malId}/full`;
            const data = await http.getJSON(url);
            const anime = data.data;

            return {
                id: `mal-${anime.mal_id}`,
                malId: anime.mal_id,
                title: anime.title || anime.title_english || 'Unknown',
                titleEnglish: anime.title_english || '',
                titleJapanese: anime.title_japanese || '',
                coverImage: anime.images?.jpg?.large_image_url || '',
                description: anime.synopsis || '',
                type: 'anime',
                source: 'jikan',
                episodes: anime.episodes || null,
                genres: (anime.genres || []).map(g => g.name),
                score: anime.score || null,
                status: anime.status || 'Unknown',
                year: anime.year || null,
                season: anime.season || null,
                studios: (anime.studios || []).map(s => s.name),
                duration: anime.duration || '',
                rating: anime.rating || ''
            };
        } catch (error) {
            console.error('Jikan details error:', error);
            return null;
        }
    }
}
