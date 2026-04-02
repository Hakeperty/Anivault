/**
 * HiAnime Scraper (API-based)
 * Uses the aniwatch-api REST endpoints (which serve HiAnime data).
 * Direct scraping of hianime.to fails due to Cloudflare JS challenges.
 * Shares the same configurable API backend as the AniWatch scraper.
 */

import { http } from '../utils/http.js';
import { AniWatchScraper } from './aniwatch.js';

export class HiAnimeScraper {
    static async search(query) {
        try {
            const apiBase = AniWatchScraper.API_BASE;
            const data = await http.getJSON(
                `${apiBase}/api/v2/hianime/search?q=${encodeURIComponent(query)}&page=1`
            );
            const animes = data?.data?.animes || data?.animes || [];
            return animes.map(a => ({
                id: a.id || a.animeId || '',
                title: a.name || a.title || '',
                coverImage: a.poster || a.img || a.coverImage || '',
                url: a.id || '',
                source: 'hianime',
                type: 'anime',
                episodes: a.episodes || null,
                rating: a.rating || 'N/A',
                description: a.description || ''
            })).filter(r => r.id && r.title);
        } catch (error) {
            console.error('HiAnime API search error:', error);
            return [];
        }
    }

    static async getEpisodes(animeId) {
        try {
            const apiBase = AniWatchScraper.API_BASE;
            const cleanId = animeId.replace(/^(https?:\/\/[^/]+)?\/*/,'').replace(/^api\/v2\/hianime\/anime\//, '');
            const data = await http.getJSON(
                `${apiBase}/api/v2/hianime/anime/${encodeURIComponent(cleanId)}/episodes`
            );
            const eps = data?.data?.episodes || data?.episodes || [];
            return eps.map((ep, i) => ({
                episode: ep.number || ep.episodeNo || (i + 1),
                number: ep.number || ep.episodeNo || (i + 1),
                url: ep.episodeId || ep.id || '',
                title: ep.title || `Episode ${ep.number || (i + 1)}`,
                isFiller: ep.isFiller || false
            })).sort((a, b) => a.episode - b.episode);
        } catch (error) {
            console.error('HiAnime API getEpisodes error:', error);
            return [];
        }
    }

    static async getStreamUrl(episodeId) {
        try {
            const apiBase = AniWatchScraper.API_BASE;
            const cleanId = episodeId.replace(/^(https?:\/\/[^/]+)?\/*/,'');
            const data = await http.getJSON(
                `${apiBase}/api/v2/hianime/episode/sources?animeEpisodeId=${encodeURIComponent(cleanId)}`
            );

            const sources = data?.data?.sources || data?.sources || [];
            const tracks = data?.data?.tracks || data?.tracks || [];
            const hlsSource = sources.find(s => s.url?.includes('.m3u8')) || sources[0];

            if (!hlsSource?.url) return null;

            return {
                url: hlsSource.url,
                type: hlsSource.url.includes('.m3u8') ? 'hls' : 'mp4',
                quality: hlsSource.quality || 'auto',
                subtitles: tracks.filter(t => t.kind === 'captions').map(t => ({
                    lang: t.label || 'Unknown',
                    url: t.file || t.url
                }))
            };
        } catch (error) {
            console.error('HiAnime API getStreamUrl error:', error);
            return null;
        }
    }

    static async getDetails(animeId) {
        try {
            const apiBase = AniWatchScraper.API_BASE;
            const cleanId = animeId.replace(/^(https?:\/\/[^/]+)?\/*/,'');
            const data = await http.getJSON(
                `${apiBase}/api/v2/hianime/anime/${encodeURIComponent(cleanId)}`
            );
            const info = data?.data?.anime?.info || data?.anime?.info || data?.data || {};
            const moreInfo = data?.data?.anime?.moreInfo || data?.anime?.moreInfo || {};

            return {
                id: cleanId,
                title: info.name || info.title || cleanId,
                description: info.description || info.synopsis || '',
                genres: moreInfo.genres || info.genres || [],
                coverImage: info.poster || info.img || '',
                source: 'hianime',
                type: 'anime',
                rating: info.stats?.rating || moreInfo.malscore || 'N/A',
                status: moreInfo.status || info.status || 'Unknown'
            };
        } catch (error) {
            console.error('HiAnime API getDetails error:', error);
            return {
                id: animeId, title: animeId, description: '', genres: [],
                coverImage: '', source: 'hianime', type: 'anime',
                rating: 'N/A', status: 'Unknown'
            };
        }
    }
}
