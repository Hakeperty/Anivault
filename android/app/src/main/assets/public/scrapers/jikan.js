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
     * Get top airing anime
     */
    static async getTopAiring(limit = 20) {
        try {
            const url = `${JIKAN_API}/top/anime?filter=airing&limit=${limit}&sfw=true`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('Jikan top airing error:', error);
            return [];
        }
    }

    /**
     * Get most popular anime (by score)
     */
    static async getTopPopular(limit = 20) {
        try {
            const url = `${JIKAN_API}/top/anime?filter=bypopularity&limit=${limit}&sfw=true`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('Jikan top popular error:', error);
            return [];
        }
    }

    /**
     * Get upcoming anime
     */
    static async getUpcoming(limit = 15) {
        try {
            const url = `${JIKAN_API}/top/anime?filter=upcoming&limit=${limit}&sfw=true`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('Jikan upcoming error:', error);
            return [];
        }
    }

    /**
     * Get current season anime (airing this season with dates/ratings)
     */
    static async getSeasonNow(limit = 25) {
        try {
            const url = `${JIKAN_API}/seasons/now?limit=${limit}&sfw=true`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('Jikan season now error:', error);
            return [];
        }
    }

    /**
     * Search anime by genre IDs (for recommendation engine)
     * Genre IDs: 1=Action, 2=Adventure, 4=Comedy, 8=Drama, 10=Fantasy, 22=Romance, 24=Sci-Fi, etc.
     */
    static async getByGenres(genreIds = [], limit = 15) {
        try {
            if (genreIds.length === 0) return [];
            const genres = genreIds.slice(0, 3).join(',');
            const url = `${JIKAN_API}/anime?genres=${genres}&order_by=score&sort=desc&limit=${limit}&sfw=true`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('Jikan genre search error:', error);
            return [];
        }
    }

    /**
     * Get anime schedule for a specific day of the week.
     * Returns anime airing on that day (JST).
     */
    static async getScheduleByDay(day = 'monday', limit = 25) {
        try {
            const url = `${JIKAN_API}/schedules?filter=${encodeURIComponent(day)}&limit=${limit}&sfw=true`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data).map(item => ({
                ...item,
                airingDay: day
            }));
        } catch (error) {
            console.error(`Jikan schedule (${day}) error:`, error);
            return [];
        }
    }

    /**
     * Get the full weekly airing schedule grouped by day.
     * Returns { monday: [...], tuesday: [...], ... }
     */
    static async getWeeklySchedule() {
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const schedule = {};

        // Fetch in batches of 2 with delays to respect Jikan rate limits (~3 req/s)
        for (let i = 0; i < days.length; i += 2) {
            const batch = days.slice(i, i + 2);
            const results = await Promise.allSettled(
                batch.map(day => this.getScheduleByDay(day, 25))
            );
            batch.forEach((day, j) => {
                schedule[day] = results[j].status === 'fulfilled' ? results[j].value : [];
            });
            if (i + 2 < days.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        return schedule;
    }

    /**
     * Get anime recommendations for a specific anime
     */
    static async getRecommendations(malId) {
        try {
            const url = `${JIKAN_API}/anime/${malId}/recommendations`;
            const data = await http.getJSON(url);
            return (data.data || []).slice(0, 10).map(rec => {
                const entry = rec.entry || {};
                return {
                    id: `mal-${entry.mal_id}`,
                    malId: entry.mal_id,
                    title: entry.title || 'Unknown',
                    coverImage: entry.images?.jpg?.large_image_url || entry.images?.jpg?.image_url || '',
                    type: 'anime',
                    source: 'jikan',
                    url: entry.url || '',
                    votes: rec.votes || 0
                };
            });
        } catch (error) {
            console.error('Jikan recommendations error:', error);
            return [];
        }
    }

    /**
     * Get anime relations (prequels, sequels, side stories, etc.)
     */
    static async getRelations(malId) {
        try {
            const url = `${JIKAN_API}/anime/${malId}/relations`;
            const data = await http.getJSON(url);
            const relations = [];
            const SEASON_TYPES = ['Prequel', 'Sequel', 'Parent story', 'Side story', 'Alternative version', 'Spin-off', 'Summary'];

            for (const group of (data.data || [])) {
                const relType = group.relation || '';
                if (!SEASON_TYPES.includes(relType)) continue;
                for (const entry of (group.entry || [])) {
                    if (entry.type !== 'anime') continue;
                    relations.push({
                        malId: entry.mal_id,
                        id: `mal-${entry.mal_id}`,
                        title: entry.name || 'Unknown',
                        relation: relType,
                        url: entry.url || '',
                        type: 'anime',
                        source: 'jikan'
                    });
                }
            }
            return relations;
        } catch (error) {
            console.error('Jikan relations error:', error);
            return [];
        }
    }

    /**
     * Get basic details for multiple anime by MAL IDs (for relation cards)
     */
    static async getBasicById(malId) {
        try {
            const url = `${JIKAN_API}/anime/${malId}`;
            const data = await http.getJSON(url);
            const anime = data.data;
            if (!anime) return null;
            return {
                id: `mal-${anime.mal_id}`,
                malId: anime.mal_id,
                title: anime.title || anime.title_english || 'Unknown',
                coverImage: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '',
                episodes: anime.episodes || null,
                score: anime.score || null,
                type: 'anime',
                source: 'jikan',
                url: anime.url || '',
                genres: (anime.genres || []).map(g => g.name).filter(Boolean),
                year: anime.year || null,
                status: anime.status || 'Unknown'
            };
        } catch (error) {
            console.error('Jikan getBasicById error:', error);
            return null;
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
                    genreIds: (anime.genres || []).map(g => g.mal_id).filter(Boolean),
                    score: anime.score || null,
                    status: anime.status || 'Unknown',
                    year: anime.year || (anime.aired?.prop?.from?.year) || null,
                    season: anime.season || null,
                    airedFrom: anime.aired?.from || null,
                    broadcast: anime.broadcast?.string || anime.broadcast?.time || null
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
