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

    static async getAnimeEpisodes(animeId, animeUrl, source = 'aniwatch', animeTitle = '', expectedEps = null) {
        // Skip slug extraction for non-aniwatch sources (e.g. jikan "mal-XXXXX" IDs)
        const isAniwatch = !source || source === 'aniwatch' || source === 'hianime';
        const fromId = isAniwatch ? this._extractAniwatchSlug(animeId) : '';
        const fromUrl = isAniwatch ? this._extractAniwatchSlug(animeUrl) : '';
        const targetSlug = fromId || fromUrl;

        try {
            if (targetSlug) {
                const eps = await AniWatchScraper.getEpisodes(targetSlug);
                if (eps.length > 0) return eps;
            }

            // Fallback: search AniWatch by title with smart matching
            if (animeTitle) {
                const searchResults = await AniWatchScraper.search(animeTitle);
                if (searchResults.length > 0) {
                    const bestMatch = this._findBestMatch(searchResults, animeTitle, expectedEps);
                    if (bestMatch?.id) {
                        return await AniWatchScraper.getEpisodes(bestMatch.id);
                    }
                }
            }

            if (targetSlug) {
                return await AniWatchScraper.getEpisodes(animeId || animeUrl);
            }
            return [];
        } catch (error) {
            console.error('Failed to get episodes:', error);
            return [];
        }
    }

    /**
     * Smart match: score each AniWatch result against the Jikan item
     * to avoid picking a same-name TV series when the user wants the Movie.
     */
    static _findBestMatch(results, title, expectedEps = null) {
        const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetNorm = normalize(title);

        let best = null;
        let bestScore = -1;

        for (const r of results) {
            let score = 0;
            const rNorm = normalize(r.title);

            // Exact title match
            if (rNorm === targetNorm) {
                score += 100;
            } else if (rNorm.includes(targetNorm) || targetNorm.includes(rNorm)) {
                score += 50;
            } else {
                const targetWords = targetNorm.match(/[a-z0-9]+/g) || [];
                const rWords = rNorm.match(/[a-z0-9]+/g) || [];
                const overlap = targetWords.filter(w => rWords.includes(w)).length;
                score += overlap * 10;
            }

            // Episode count matching — heavily penalize mismatches
            const rEpCount = r.episodes?.sub || r.episodes?.total || 0;
            if (expectedEps && rEpCount) {
                if (rEpCount === expectedEps) {
                    score += 60; // strong match
                } else if (Math.abs(rEpCount - expectedEps) <= 2) {
                    score += 20; // close enough (sometimes counts differ slightly)
                } else {
                    // Big mismatch: e.g. movie (1 ep) vs TV (12 eps)
                    score -= 40;
                }
            }

            // Type hint: movies get bonus if expected eps is 1
            const rType = (r.animeType || '').toLowerCase();
            if (expectedEps === 1 && rType === 'movie') score += 30;
            if (expectedEps === 1 && rType === 'tv') score -= 20;

            // Prefer results where the title is closer in length
            const lenDiff = Math.abs(rNorm.length - targetNorm.length);
            score -= lenDiff * 0.5;

            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }

        return best;
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

    /** Get trending/popular content for the Discover screen */
    static async getTrending() {
        const [airing, popular, upcoming, seasonNow, mangaPopular, mangaRecent] = await Promise.allSettled([
            JikanScraper.getTopAiring(20),
            JikanScraper.getTopPopular(20),
            JikanScraper.getUpcoming(20),
            JikanScraper.getSeasonNow(25),
            MangaDexScraper.getPopular(20),
            MangaDexScraper.getRecentlyUpdated(15)
        ]);

        return {
            airing: airing.status === 'fulfilled' ? airing.value : [],
            popular: popular.status === 'fulfilled' ? popular.value : [],
            upcoming: upcoming.status === 'fulfilled' ? upcoming.value : [],
            seasonNow: seasonNow.status === 'fulfilled' ? seasonNow.value : [],
            mangaPopular: mangaPopular.status === 'fulfilled' ? mangaPopular.value : [],
            mangaRecent: mangaRecent.status === 'fulfilled' ? mangaRecent.value : []
        };
    }

    /**
     * Build personalized recommendations from watch history.
     * Analyzes genres from library items, fetches similar anime via Jikan.
     */
    static async getRecommendations(libraryItems = []) {
        try {
            if (libraryItems.length === 0) return [];

            // Collect genre frequencies from watched items
            const genreCount = {};
            const genreIdMap = {};
            const watchedIds = new Set(libraryItems.map(i => i.id));

            for (const item of libraryItems) {
                if (item.type !== 'anime') continue;
                for (const g of (item.genres || [])) {
                    genreCount[g] = (genreCount[g] || 0) + 1;
                }
                for (const gid of (item.genreIds || [])) {
                    genreIdMap[gid] = (genreIdMap[gid] || 0) + 1;
                }
            }

            // Get top 3 genre IDs by frequency
            const topGenreIds = Object.entries(genreIdMap)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([id]) => Number(id));

            if (topGenreIds.length === 0) return [];

            // Fetch genre-based recommendations
            const results = await JikanScraper.getByGenres(topGenreIds, 20);

            // Filter out already-watched items
            return results.filter(r => !watchedIds.has(r.id));
        } catch (error) {
            console.error('Recommendations error:', error);
            return [];
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
