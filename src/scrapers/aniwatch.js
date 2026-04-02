/**
 * AniWatch Scraper (API-based)
 * Uses the aniwatch-api REST endpoints to fetch anime data.
 * Direct scraping of aniwatch.to fails due to Cloudflare JS challenges,
 * so we use a compatible API backend instead.
 */

import { http } from '../utils/http.js';

const DEFAULT_API = 'https://api-aniwatch.onrender.com';

let _apiBase = DEFAULT_API;

export class AniWatchScraper {
    static get API_BASE() { return _apiBase; }
    static set API_BASE(url) { _apiBase = (url || DEFAULT_API).replace(/\/+$/, ''); }

    static async search(query) {
        try {
            const data = await http.getJSON(
                `${_apiBase}/api/v2/hianime/search?q=${encodeURIComponent(query)}&page=1`
            );
            const animes = data?.data?.animes || data?.animes || [];
            return animes.map(a => ({
                id: a.id || a.animeId || '',
                title: a.name || a.title || '',
                type: 'anime',
                source: 'aniwatch',
                sourceId: a.id || a.animeId || '',
                coverUrl: a.poster || a.img || a.coverImage || '',
                url: a.id ? `${_apiBase}/api/v2/hianime/anime/${a.id}` : '',
                slug: a.id || '',
                description: a.description || '',
                episodes: a.episodes || null,
                rating: a.rating || 'N/A'
            })).filter(r => r.id && r.title);
        } catch (error) {
            console.error('AniWatch API search error:', error);
            return [];
        }
    }

    static async getEpisodes(id) {
        try {
            const cleanId = id.replace(/^\/+/, '');
            const data = await http.getJSON(
                `${_apiBase}/api/v2/hianime/anime/${encodeURIComponent(cleanId)}/episodes`
            );
            const eps = data?.data?.episodes || data?.episodes || [];
            return eps.map((ep, i) => ({
                number: ep.number || ep.episodeNo || (i + 1),
                title: ep.title || `Episode ${ep.number || (i + 1)}`,
                url: ep.episodeId || ep.id || '',
                id: ep.episodeId || ep.id || `${cleanId}-ep${ep.number || (i + 1)}`,
                isFiller: ep.isFiller || false
            })).sort((a, b) => a.number - b.number);
        } catch (error) {
            console.error('AniWatch API getEpisodes error:', error);
            return [];
        }
    }

    static async getStreamUrl(episodeId) {
        try {
            const cleanId = episodeId.replace(/^\/+/, '');
            const data = await http.getJSON(
                `${_apiBase}/api/v2/hianime/episode/sources?animeEpisodeId=${encodeURIComponent(cleanId)}`
            );

            const sources = data?.data?.sources || data?.sources || [];
            const subtitles = data?.data?.tracks || data?.tracks || [];

            const hlsSource = sources.find(s => s.url?.includes('.m3u8')) || sources[0];

            if (!hlsSource?.url) {
                console.warn('No stream URL found for episode:', episodeId);
                return { url: null, quality: 'auto', type: 'hls' };
            }

            return {
                url: hlsSource.url,
                quality: hlsSource.quality || 'auto',
                type: hlsSource.url.includes('.m3u8') ? 'hls' : 'mp4',
                episodeId: cleanId,
                subtitles: subtitles.filter(t => t.kind === 'captions').map(t => ({
                    lang: t.label || 'Unknown',
                    url: t.file || t.url
                }))
            };
        } catch (error) {
            console.error('AniWatch API getStreamUrl error:', error);
            return { url: null, quality: 'auto', type: 'hls' };
        }
    }

    static async getDetails(id) {
        try {
            const cleanId = id.replace(/^\/+/, '');
            const data = await http.getJSON(
                `${_apiBase}/api/v2/hianime/anime/${encodeURIComponent(cleanId)}`
            );
            const info = data?.data?.anime?.info || data?.anime?.info || data?.data || {};
            const moreInfo = data?.data?.anime?.moreInfo || data?.anime?.moreInfo || {};

            return {
                id: cleanId,
                title: info.name || info.title || cleanId,
                description: info.description || info.synopsis || '',
                genres: moreInfo.genres || info.genres || [],
                coverUrl: info.poster || info.img || info.coverImage || '',
                source: 'aniwatch',
                type: 'anime',
                rating: info.stats?.rating || moreInfo.malscore || 'N/A',
                status: moreInfo.status || info.status || 'Unknown',
                totalEpisodes: info.stats?.episodes?.sub || info.totalEpisodes || null
            };
        } catch (error) {
            console.error('AniWatch API getDetails error:', error);
            return {
                id, title: id, description: '', genres: [], coverUrl: '',
                source: 'aniwatch', type: 'anime', rating: 'N/A', status: 'Unknown'
            };
        }
    }
}
