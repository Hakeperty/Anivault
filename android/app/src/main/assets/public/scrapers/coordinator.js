/**
 * Multi-Source Search Coordinator
 * Searches all scrapers in parallel, deduplicates, and merges results.
 * Priority order (first source wins on dedupe):
 * Anime: AniWatch
 * Manga: MangaDex API + MangaKatana + MangaPill (fallback)
 */

import { AniWatchScraper } from './aniwatch.js';
import { MangaDexScraper } from './mangadex.js';
import { MangaKatanaScraper } from './mangakatana.js';
import { MangaPillScraper } from './mangapill.js';
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
            promises.push(
                MangaPillScraper.search(query)
                    .then(r => ({ type: 'manga', source: 'mangapill', results: r }))
                    .catch(e => { console.error('MangaPill failed:', e); return { type: 'manga', source: 'mangapill', results: [] }; })
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

        // Sort results by relevance to query (checks both title and titleEnglish)
        const sortByRelevance = (items) => {
            const qNorm = this._normalizeTitle(query);
            return items.sort((a, b) => {
                const scoreA = Math.max(
                    this._wordOverlapScore(qNorm, this._normalizeTitle(a.title)),
                    a.titleEnglish ? this._wordOverlapScore(qNorm, this._normalizeTitle(a.titleEnglish)) : 0
                );
                const scoreB = Math.max(
                    this._wordOverlapScore(qNorm, this._normalizeTitle(b.title)),
                    b.titleEnglish ? this._wordOverlapScore(qNorm, this._normalizeTitle(b.titleEnglish)) : 0
                );
                return scoreB - scoreA;
            });
        };

        return {
            anime: sortByRelevance(dedupedAnime),
            manga: sortByRelevance(dedupedManga),
            all: sortByRelevance([
                ...dedupedAnime.map(r => ({ ...r, type: 'anime' })),
                ...dedupedManga.map(r => ({ ...r, type: 'manga' }))
            ])
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
            // 1. Direct slug if available
            if (targetSlug) {
                const eps = await AniWatchScraper.getEpisodes(targetSlug);
                if (eps.length > 0) return eps;
            }

            // 2. Search AniWatch by title with smart matching
            if (animeTitle) {
                const eps = await this._searchAndMatchEpisodes(animeTitle, expectedEps);
                if (eps.length > 0) return eps;

                // 3. Retry with cleaned title (remove season markers, parentheticals, etc.)
                const cleanedTitle = animeTitle
                    .replace(/\s*\(.*?\)\s*/g, ' ')        // remove (TV), (2024), etc.
                    .replace(/\s*season\s*\d+/gi, '')       // remove "Season 2"
                    .replace(/\s*\d+(st|nd|rd|th)\s+season/gi, '') // remove "2nd Season"
                    .replace(/\s*part\s*\d+/gi, '')         // remove "Part 2"
                    .replace(/\s+/g, ' ').trim();

                if (cleanedTitle && cleanedTitle !== animeTitle) {
                    const cleanEps = await this._searchAndMatchEpisodes(cleanedTitle, expectedEps);
                    if (cleanEps.length > 0) return cleanEps;
                }
            }

            // 4. Last resort: try raw ID
            if (targetSlug) {
                return await AniWatchScraper.getEpisodes(animeId || animeUrl);
            }
            return [];
        } catch (error) {
            console.error('Failed to get episodes:', error);
            return [];
        }
    }

    /** Search AniWatch by title and get episodes from best match */
    static async _searchAndMatchEpisodes(title, expectedEps) {
        try {
            const searchResults = await AniWatchScraper.search(title);
            if (searchResults.length > 0) {
                const bestMatch = this._findBestMatch(searchResults, title, expectedEps);
                if (bestMatch?.id) {
                    const eps = await AniWatchScraper.getEpisodes(bestMatch.id);
                    if (eps.length > 0) return eps;
                }
            }
        } catch (e) {
            console.warn('[Coordinator] AniWatch search+match failed for', title, e.message);
        }
        return [];
    }

    /**
     * Smart match: score each AniWatch result against the Jikan item
     * to avoid picking a same-name TV series when the user wants the Movie.
     * Returns null if no result is a sufficiently good match.
     */
    static _findBestMatch(results, title, expectedEps = null) {
        if (!results || results.length === 0) return null;

        const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetNorm = normalize(title);
        const targetWords = (title || '').toLowerCase().match(/[a-z0-9]+/g) || [];

        // Extract season number from title (e.g. "... 2", "... Season 3")
        const seasonMatch = title.match(/(?:\s+(\d)$|\s+season\s*(\d+)|\s+(\d+)(?:st|nd|rd|th)\s+season)/i);
        const targetSeason = seasonMatch ? parseInt(seasonMatch[1] || seasonMatch[2] || seasonMatch[3]) : null;

        let best = null;
        let bestScore = -1;

        for (const r of results) {
            let score = 0;
            const rNorm = normalize(r.title);
            const rWords = (r.title || '').toLowerCase().match(/[a-z0-9]+/g) || [];

            // Exact title match
            if (rNorm === targetNorm) {
                score += 100;
            } else if (rNorm.includes(targetNorm) || targetNorm.includes(rNorm)) {
                score += 50;
            } else {
                // Word overlap scoring
                const overlap = targetWords.filter(w => rWords.includes(w)).length;
                const maxWords = Math.max(targetWords.length, rWords.length, 1);
                const overlapRatio = overlap / maxWords;
                score += overlapRatio * 80;
            }

            // Season number matching — critical for sequels
            if (targetSeason) {
                const rSeasonMatch = r.title?.match(/(?:\s+(\d)$|\s+season\s*(\d+)|\s+(\d+)(?:st|nd|rd|th)\s+season)/i);
                const rSeason = rSeasonMatch ? parseInt(rSeasonMatch[1] || rSeasonMatch[2] || rSeasonMatch[3]) : null;
                if (rSeason === targetSeason) {
                    score += 50; // strong season match
                } else if (rSeason && rSeason !== targetSeason) {
                    score -= 60; // wrong season — heavy penalty
                } else if (!rSeason && targetSeason > 1) {
                    score -= 30; // looking for S2+ but result has no season marker
                }
            }

            // Episode count — lenient for airing shows (AniWatch may have fewer)
            const rEpCount = r.episodes?.sub || r.episodes?.total || 0;
            if (expectedEps && rEpCount) {
                if (rEpCount === expectedEps) {
                    score += 40;
                } else if (rEpCount < expectedEps) {
                    // AniWatch has fewer — likely airing, don't penalize much
                    score += 10;
                } else if (Math.abs(rEpCount - expectedEps) <= 2) {
                    score += 20;
                } else {
                    // AniWatch has MORE eps than expected — wrong show
                    score -= 40;
                }
            }

            // Type hint: movies get bonus if expected eps is 1
            const rType = (r.animeType || '').toLowerCase();
            if (expectedEps === 1 && rType === 'movie') score += 30;
            if (expectedEps === 1 && rType === 'tv') score -= 20;

            // Prefer results where the title is closer in length
            const lenDiff = Math.abs(rNorm.length - targetNorm.length);
            score -= lenDiff * 0.3;

            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }

        // Minimum quality threshold — reject bad matches
        if (bestScore < 25) {
            console.warn(`[Coordinator] No good AniWatch match for "${title}" (best score: ${bestScore.toFixed(1)})`);
            return null;
        }

        return best;
    }

    static async getMangaChapters(mangaId, source = 'mangakatana', mangaUrl = '', mangaTitle = '', altTitle = '') {
        const normalizedSource = String(source || '').toLowerCase();
        const katanaTarget = mangaUrl || mangaId;

        // Try primary source
        let chapters = [];
        try {
            if (normalizedSource === 'mangakatana') {
                chapters = await MangaKatanaScraper.getChapters(katanaTarget);
            } else if (normalizedSource === 'mangapill') {
                chapters = await MangaPillScraper.getChapters(mangaUrl || mangaId);
            } else {
                chapters = await MangaDexScraper.getChapters(mangaId);
            }
        } catch (error) {
            console.warn('Primary chapter source failed:', source, error.message);
        }

        // Fallback to secondary source if primary returned nothing
        if (!chapters || chapters.length === 0) {
            try {
                console.log('[Coordinator] Trying fallback chapter source for', mangaId);
                if (normalizedSource === 'mangakatana') {
                    // MangaKatana failed → try MangaDex by searching title
                    if (mangaTitle) {
                        const mdexResults = await MangaDexScraper.search(mangaTitle);
                        const match = this._bestMangaMatch(mdexResults, mangaTitle);
                        if (match) chapters = await MangaDexScraper.getChapters(match.id);
                    } else {
                        chapters = await MangaDexScraper.getChapters(mangaId);
                    }
                } else {
                    // MangaDex failed → search MangaKatana by title
                    if (mangaTitle) {
                        let katanaResults = await MangaKatanaScraper.search(mangaTitle);
                        let match = this._bestMangaMatch(katanaResults, mangaTitle);

                        // If Japanese/romaji title didn't match, try English alt title
                        if (!match && altTitle && altTitle !== mangaTitle) {
                            console.log('[Coordinator] Retrying MangaKatana with alt title:', altTitle);
                            katanaResults = await MangaKatanaScraper.search(altTitle);
                            match = this._bestMangaMatch(katanaResults, altTitle);
                            // MangaKatana may return Japanese-titled results for English searches
                            if (!match) match = this._bestMangaMatch(katanaResults, mangaTitle);
                        }

                        // Last resort: look up English title via Jikan
                        if (!match) {
                            try {
                                const englishTitle = await this._lookupEnglishTitle(mangaTitle);
                                if (englishTitle && englishTitle !== mangaTitle && englishTitle !== altTitle) {
                                    console.log('[Coordinator] Jikan English title lookup:', englishTitle);
                                    katanaResults = await MangaKatanaScraper.search(englishTitle);
                                    match = this._bestMangaMatch(katanaResults, englishTitle);
                                    if (!match) match = this._bestMangaMatch(katanaResults, mangaTitle);
                                }
                            } catch (e) {
                                console.warn('[Coordinator] Jikan title lookup failed:', e.message);
                            }
                        }

                        if (match) chapters = await MangaKatanaScraper.getChapters(match.url || match.id);
                    } else if (katanaTarget.startsWith('http') || katanaTarget.startsWith('/')) {
                        chapters = await MangaKatanaScraper.getChapters(katanaTarget);
                    }
                }
            } catch (fallbackErr) {
                console.error('Fallback chapter source also failed:', fallbackErr.message);
            }
        }

        // MangaPill as ultimate fallback if still no chapters
        if (!chapters || chapters.length === 0) {
            try {
                console.log('[Coordinator] Trying MangaPill fallback for', mangaTitle || mangaId);
                const searchTerms = [mangaTitle, altTitle].filter(Boolean);
                // Also try Jikan English title if we don't have altTitle
                if (!altTitle && mangaTitle) {
                    try {
                        const enTitle = await this._lookupEnglishTitle(mangaTitle);
                        if (enTitle && enTitle !== mangaTitle) searchTerms.push(enTitle);
                    } catch (_) {}
                }

                for (const term of searchTerms) {
                    const pillResults = await MangaPillScraper.search(term);
                    const match = this._bestMangaMatch(pillResults, mangaTitle) ||
                        (altTitle ? this._bestMangaMatch(pillResults, altTitle) : null);
                    if (match) {
                        chapters = await MangaPillScraper.getChapters(match.url || match.id);
                        if (chapters.length > 0) {
                            console.log(`[Coordinator] MangaPill found ${chapters.length} chapters`);
                            break;
                        }
                    }
                }
            } catch (e) {
                console.warn('[Coordinator] MangaPill fallback failed:', e.message);
            }
        }

        return chapters || [];
    }

    static async getChapterPages(chapterId, source = 'mangakatana', mangaTitle = '', chapterNumber = null, altTitle = '') {
        const normalizedSource = String(source || '').toLowerCase();
        const chapterIdString = String(chapterId || '');
        const normalizePages = (pages) => (pages || [])
            .map((page) => (typeof page === 'string' ? page : page?.url))
            .filter(Boolean);

        // Try primary source
        let pages = [];
        try {
            if (normalizedSource === 'mangakatana') {
                pages = normalizePages(await MangaKatanaScraper.getPages(chapterId));
            } else if (normalizedSource === 'mangapill') {
                pages = normalizePages(await MangaPillScraper.getPages(chapterId));
            } else {
                pages = normalizePages(await MangaDexScraper.getPages(chapterId));
            }
        } catch (error) {
            console.warn('Primary page source failed:', source, error.message);
        }

        // If primary returned pages, we're done
        if (pages && pages.length > 0) return pages;

        // Smart cross-source fallback: search the other source by manga title + chapter number
        if (mangaTitle && chapterNumber !== null) {
            console.log(`[Coordinator] Cross-source page fallback: "${mangaTitle}" ch.${chapterNumber}`);
            try {
                const fallbackPages = await this._crossSourcePageFallback(
                    normalizedSource, mangaTitle, chapterNumber, altTitle
                );
                if (fallbackPages.length > 0) return fallbackPages;
            } catch (e) {
                console.warn('[Coordinator] Cross-source fallback failed:', e.message);
            }
        }

        // Last resort: try passing ID directly to other source (may work for URL-based IDs)
        if (chapterIdString.startsWith('http') || chapterIdString.startsWith('/')) {
            try {
                if (normalizedSource === 'mangakatana') {
                    pages = normalizePages(await MangaDexScraper.getPages(chapterId));
                } else {
                    pages = normalizePages(await MangaKatanaScraper.getPages(chapterId));
                }
            } catch (e) {
                console.debug('[Coordinator] Direct ID page fallback failed:', e.message);
            }
        }

        // MangaPill as ultimate page fallback
        if ((!pages || pages.length === 0) && mangaTitle && chapterNumber !== null) {
            try {
                console.log(`[Coordinator] MangaPill page fallback: "${mangaTitle}" ch.${chapterNumber}`);
                const searchTerms = [mangaTitle, altTitle].filter(Boolean);
                for (const term of searchTerms) {
                    const pillResults = await MangaPillScraper.search(term);
                    const match = this._bestMangaMatch(pillResults, term) ||
                        this._bestMangaMatch(pillResults, mangaTitle) ||
                        (altTitle ? this._bestMangaMatch(pillResults, altTitle) : null);
                    if (match) {
                        const chapters = await MangaPillScraper.getChapters(match.url || match.id);
                        const targetCh = chapters.find(ch => ch.chapter === chapterNumber);
                        if (targetCh) {
                            pages = normalizePages(await MangaPillScraper.getPages(targetCh.url || targetCh.id));
                            if (pages.length > 0) break;
                        }
                    }
                }
            } catch (e) {
                console.warn('[Coordinator] MangaPill page fallback failed:', e.message);
            }
        }

        return pages || [];
    }

    /**
     * Cross-source page fallback: search the alternate source for the same manga,
     * find a matching chapter by number, and load pages from it.
     */
    static async _crossSourcePageFallback(failedSource, mangaTitle, chapterNumber, altTitle = '') {
        const normalizePages = (pages) => (pages || [])
            .map((page) => (typeof page === 'string' ? page : page?.url))
            .filter(Boolean);

        if (failedSource === 'mangadex') {
            // MangaDex failed → try MangaKatana
            let searchResults = await MangaKatanaScraper.search(mangaTitle);
            let match = this._bestMangaMatch(searchResults, mangaTitle);

            // Retry with English alt title if Japanese title didn't match
            if (!match && altTitle && altTitle !== mangaTitle) {
                searchResults = await MangaKatanaScraper.search(altTitle);
                match = this._bestMangaMatch(searchResults, altTitle);
                // MangaKatana may return Japanese-titled results for English searches
                if (!match) match = this._bestMangaMatch(searchResults, mangaTitle);
            }
            // If altTitle is missing, try deriving English title via Jikan
            if (!match && !altTitle && mangaTitle) {
                try {
                    const englishTitle = await this._lookupEnglishTitle(mangaTitle);
                    if (englishTitle && englishTitle !== mangaTitle) {
                        searchResults = await MangaKatanaScraper.search(englishTitle);
                        match = this._bestMangaMatch(searchResults, englishTitle);
                        if (!match) match = this._bestMangaMatch(searchResults, mangaTitle);
                    }
                } catch (e) {
                    console.warn('[Coordinator] Jikan title lookup failed:', e.message);
                }
            }
            if (!match) return [];

            const chapters = await MangaKatanaScraper.getChapters(match.url || match.id);
            const targetCh = chapters.find(ch => ch.chapter === chapterNumber);
            if (!targetCh) return [];

            console.log(`[Coordinator] Found MangaKatana fallback: ${targetCh.url || targetCh.id}`);
            return normalizePages(await MangaKatanaScraper.getPages(targetCh.url || targetCh.id));
        } else {
            // MangaKatana failed → try MangaDex
            let searchResults = await MangaDexScraper.search(mangaTitle);
            let match = this._bestMangaMatch(searchResults, mangaTitle);

            // Retry with English alt title if Japanese title didn't match
            if (!match && altTitle && altTitle !== mangaTitle) {
                searchResults = await MangaDexScraper.search(altTitle);
                match = this._bestMangaMatch(searchResults, altTitle);
                if (!match) match = this._bestMangaMatch(searchResults, mangaTitle);
            }
            // If altTitle is missing, try deriving English title via Jikan
            if (!match && !altTitle && mangaTitle) {
                try {
                    const englishTitle = await this._lookupEnglishTitle(mangaTitle);
                    if (englishTitle && englishTitle !== mangaTitle) {
                        searchResults = await MangaDexScraper.search(englishTitle);
                        match = this._bestMangaMatch(searchResults, englishTitle);
                        if (!match) match = this._bestMangaMatch(searchResults, mangaTitle);
                    }
                } catch (e) {
                    console.warn('[Coordinator] Jikan title lookup failed:', e.message);
                }
            }
            if (!match) return [];

            const chapters = await MangaDexScraper.getChapters(match.id);
            const targetCh = chapters.find(ch => ch.chapter === chapterNumber);
            if (!targetCh) return [];

            console.log(`[Coordinator] Found MangaDex fallback: ${targetCh.id}`);
            return normalizePages(await MangaDexScraper.getPages(targetCh.id));
        }
    }

    /**
     * Look up the English title of a manga via Jikan (MyAnimeList).
     * Useful when MangaDex only has the romaji title and MangaKatana
     * needs the English name to find it.
     */
    static async _lookupEnglishTitle(mangaTitle) {
        try {
            const url = `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(mangaTitle)}&limit=5`;
            const data = await (await fetch(url)).json();
            if (!data.data?.length) return null;

            const targetNorm = this._normalizeTitle(mangaTitle);
            for (const item of data.data) {
                const titleNorm = this._normalizeTitle(item.title || '');
                const overlap = this._wordOverlapScore(targetNorm, titleNorm);
                if (overlap >= 0.6 && item.title_english) {
                    return item.title_english;
                }
            }
            // Fallback: if first result has English title, use it
            if (data.data[0].title_english) return data.data[0].title_english;
            return null;
        } catch (e) {
            console.warn('[Coordinator] Jikan manga lookup failed:', e.message);
            return null;
        }
    }

    /**
     * Normalize a title for comparison.
     * Keeps alphanumeric chars and common romanized-Japanese particles so that
     * titles like "Sono Bisque Doll wa Koi o Suru" compare correctly.
     */
    static _normalizeTitle(s) {
        return (s || '')
            .toLowerCase()
            .normalize('NFKD')                   // decompose accented chars
            .replace(/[\u0300-\u036f]/g, '')      // strip combining diacritics
            .replace(/[^a-z0-9\s]/g, ' ')         // non-alphanum → space
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Compute word-overlap score between two normalized title strings.
     * Returns a value between 0 and 1 representing the fraction of words
     * in the shorter title that appear in the longer one.
     */
    static _wordOverlapScore(a, b) {
        const aWords = a.split(' ').filter(Boolean);
        const bWords = b.split(' ').filter(Boolean);
        if (aWords.length === 0 || bWords.length === 0) return 0;
        const [shorter, longer] = aWords.length <= bWords.length
            ? [aWords, new Set(bWords)]
            : [bWords, new Set(aWords)];
        const matches = shorter.filter(w => longer.has(w)).length;
        return matches / shorter.length;
    }

    /**
     * Find best manga title match from search results.
     * Returns null if no result meets a minimum quality threshold so that
     * callers never receive an unrelated manga as a "match".
     */
    static _bestMangaMatch(results, title) {
        if (!results || results.length === 0) return null;

        const targetNorm = this._normalizeTitle(title);
        const targetCompact = targetNorm.replace(/\s/g, '');

        let best = null;
        let bestScore = -Infinity;

        for (const r of results) {
            const rNorm = this._normalizeTitle(r.title);
            const rCompact = rNorm.replace(/\s/g, '');
            // Also check English alt title for matching
            const rEnNorm = r.titleEnglish ? this._normalizeTitle(r.titleEnglish) : '';
            const rEnCompact = rEnNorm.replace(/\s/g, '');
            let score = 0;

            // Exact compact match (ignoring spaces/punctuation)
            if (rCompact === targetCompact || (rEnCompact && rEnCompact === targetCompact)) {
                return r; // perfect match — short-circuit
            }

            // Substring containment (check both primary and English title)
            if (rCompact.includes(targetCompact) || targetCompact.includes(rCompact) ||
                (rEnCompact && (rEnCompact.includes(targetCompact) || targetCompact.includes(rEnCompact)))) {
                score += 80;
            }

            // Word overlap — use best of primary title and English title
            const overlap = this._wordOverlapScore(targetNorm, rNorm);
            const enOverlap = rEnNorm ? this._wordOverlapScore(targetNorm, rEnNorm) : 0;
            score += Math.max(overlap, enOverlap) * 100;

            // Penalize large length differences (use closer title)
            const lenDiff = Math.min(
                Math.abs(rCompact.length - targetCompact.length),
                rEnCompact ? Math.abs(rEnCompact.length - targetCompact.length) : Infinity
            );
            score -= lenDiff * 0.5;

            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }

        // Require at least 50% word overlap OR a containment match (score >= 80)
        if (best) {
            const bestOverlap = Math.max(
                this._wordOverlapScore(targetNorm, this._normalizeTitle(best.title)),
                best.titleEnglish ? this._wordOverlapScore(targetNorm, this._normalizeTitle(best.titleEnglish)) : 0
            );
            if (bestScore >= 80 || bestOverlap >= 0.5) {
                return best;
            }
        }

        return null; // no sufficiently good match — caller handles null
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
        // Fetch main data first (4 Jikan + 2 MangaDex calls)
        const [airing, popular, upcoming, seasonNow, mangaPopular, mangaRecent] = await Promise.allSettled([
            JikanScraper.getTopAiring(20),
            JikanScraper.getTopPopular(20),
            JikanScraper.getUpcoming(20),
            JikanScraper.getSeasonNow(25),
            MangaDexScraper.getPopular(20),
            MangaDexScraper.getRecentlyUpdated(15)
        ]);

        // Delay before schedule fetch to avoid Jikan rate limits
        await new Promise(r => setTimeout(r, 1200));

        let weeklySchedule = {};
        try {
            weeklySchedule = await JikanScraper.getWeeklySchedule();
        } catch (e) {
            console.warn('Weekly schedule fetch failed:', e.message);
        }

        return {
            airing: airing.status === 'fulfilled' ? airing.value : [],
            popular: popular.status === 'fulfilled' ? popular.value : [],
            upcoming: upcoming.status === 'fulfilled' ? upcoming.value : [],
            seasonNow: seasonNow.status === 'fulfilled' ? seasonNow.value : [],
            mangaPopular: mangaPopular.status === 'fulfilled' ? mangaPopular.value : [],
            mangaRecent: mangaRecent.status === 'fulfilled' ? mangaRecent.value : [],
            weeklySchedule
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
