/**
 * MangaDex Scraper
 * Uses official MangaDex REST API v5 (no scraping needed)
 * Much more reliable than HTML scraping
 */

import { http } from '../utils/http.js';

const MANGADEX_API = 'https://api.mangadex.org';

export class MangaDexScraper {
    /**
     * Get the best available title from MangaDex attributes
     */
    static _getTitle(attributes) {
        const t = attributes.title || {};
        // Try common keys in preference order
        if (t.en) return t.en;
        if (t['ja-ro']) return t['ja-ro'];
        if (t['ko-ro']) return t['ko-ro'];
        if (t['zh-ro']) return t['zh-ro'];
        // Check altTitles for English
        const alts = attributes.altTitles || [];
        for (const alt of alts) {
            if (alt.en) return alt.en;
        }
        // Fallback: prefer romanized titles over raw Japanese/Chinese/Korean
        for (const key of Object.keys(t)) {
            if (key.endsWith('-ro') || key === 'en') return t[key];
        }
        const vals = Object.values(t);
        return vals.length > 0 ? vals[0] : 'Unknown';
    }

    /**
     * Search for manga on MangaDex.
     * Tries the title query first; if no results, retries with the original
     * query as an alt-title to catch Japanese/romaji names like
     * "Sono Bisque Doll wa Koi o Suru".
     */
    static async search(query) {
        try {
            const baseParams = () => {
                const p = new URLSearchParams();
                p.set('limit', '15');
                p.append('includes[]', 'cover_art');
                p.append('contentRating[]', 'safe');
                p.append('contentRating[]', 'suggestive');
                p.append('contentRating[]', 'erotica');
                return p;
            };

            // Primary search by title
            const params = baseParams();
            params.set('title', query);
            const url = `${MANGADEX_API}/manga?${params.toString()}`;
            const data = await http.getJSON(url);
            let results = this.parseSearchResults(data);

            // If no results, retry with the query in the generic order parameter
            // which searches across title + altTitles. This helps find manga by
            // Japanese or romanised titles (e.g. "Sono Bisque Doll wa Koi o Suru").
            if (results.length === 0) {
                const altParams = baseParams();
                altParams.set('title', query);
                altParams.set('order[relevance]', 'desc');
                const altUrl = `${MANGADEX_API}/manga?${altParams.toString()}`;
                const altData = await http.getJSON(altUrl);
                results = this.parseSearchResults(altData);
            }

            return await this._attachStatistics(results);
        } catch (error) {
            console.error('MangaDex search error:', error);
            return [];
        }
    }

    /**
     * Get chapter list for a manga.
     * Paginates through all results (MangaDex caps each response at 500).
     * Deduplicates by chapter number (keeps first occurrence per number).
     */
    static async getChapters(mangaId) {
        try {
            const allChapters = [];
            const PAGE_LIMIT = 500;
            let offset = 0;
            let total = Infinity;

            while (offset < total) {
                const params = new URLSearchParams();
                params.set('limit', String(PAGE_LIMIT));
                params.set('offset', String(offset));
                params.set('order[chapter]', 'asc');
                params.append('translatedLanguage[]', 'en');

                const url = `${MANGADEX_API}/manga/${mangaId}/feed?${params.toString()}`;
                const data = await http.getJSON(url);
                total = data.total ?? 0;

                const batch = this.parseChapterList(data);
                allChapters.push(...batch);

                offset += PAGE_LIMIT;
                // Safety: stop after 10000 or if batch was empty
                if (batch.length === 0 || offset >= 10000) break;
            }

            // Deduplicate: keep first occurrence of each chapter number
            // Chapters with null numbers (oneshots, extras) are never deduped against each other
            // Filter out external-only chapters (pages: 0, hosted off-site) that can't be read in-app
            const seen = new Set();
            return allChapters.filter(ch => {
                if (ch.pages === 0) return false; // external chapter, no in-app pages
                if (ch.chapter === null) return true; // keep all unnumbered chapters
                const key = ch.chapter;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        } catch (error) {
            console.error('MangaDex chapter fetch error:', error);
            return [];
        }
    }

    /**
     * Get pages for a chapter
     */
    static async getPages(chapterId) {
        try {
            const url = `${MANGADEX_API}/at-home/server/${chapterId}`;
            const data = await http.getJSON(url);
            return this.parsePageList(data);
        } catch (error) {
            console.error('MangaDex pages fetch error:', error);
            return [];
        }
    }

    /**
     * Parse search results from API response
     */
    static parseSearchResults(data) {
        const results = [];

        data.data?.forEach(manga => {
            try {
                const coverRelation = manga.relationships?.find(r => r.type === 'cover_art');
                const coverFilename = coverRelation?.attributes?.fileName;
                const coverUrl = coverFilename ? 
                    `https://uploads.mangadex.org/covers/${manga.id}/${coverFilename}.256.jpg` : 
                    '';

                const attributes = manga.attributes || {};

                results.push({
                    id: manga.id,
                    title: this._getTitle(attributes),
                    coverImage: coverUrl,
                    description: attributes.description?.en || '',
                    genres: (attributes.tags || [])
                        .filter(t => t.attributes?.group === 'genre')
                        .map(t => t.attributes?.name?.en).filter(Boolean),
                    chapters: attributes.lastChapter ? parseInt(attributes.lastChapter) : null,
                    year: attributes.year || null,
                    status: attributes.status || null,
                    url: `${MANGADEX_API}/manga/${manga.id}`,
                    source: 'mangadex',
                    type: 'manga',
                    score: null // filled by _attachStatistics
                });
            } catch (e) {
                console.debug('Parse error on manga:', e);
            }
        });

        return results;
    }

    /**
     * Fetch statistics (ratings) for a batch of manga and attach to items
     */
    static async _attachStatistics(items) {
        if (!items.length) return items;
        try {
            const ids = items.map(i => i.id).slice(0, 100);
            const params = ids.map(id => `manga[]=${id}`).join('&');
            const url = `${MANGADEX_API}/statistics/manga?${params}`;
            const data = await http.getJSON(url);
            const stats = data.statistics || {};
            for (const item of items) {
                const s = stats[item.id];
                if (s?.rating?.bayesian) {
                    item.score = Math.round(s.rating.bayesian * 10) / 10;
                } else if (s?.rating?.average) {
                    item.score = Math.round(s.rating.average * 10) / 10;
                }
            }
        } catch (e) {
            console.debug('MangaDex statistics fetch error:', e);
        }
        return items;
    }

    /**
     * Parse chapter list from API response.
     * Handles chapters with null/empty chapter numbers (prologue, extras, oneshots).
     */
    static parseChapterList(data) {
        const chapters = [];

        data.data?.forEach(chapter => {
            try {
                const attributes = chapter.attributes || {};
                const rawChapter = attributes.chapter;
                // Accept chapters with null/empty chapter number (prologues, oneshots, extras)
                // Assign them a synthetic number based on position to preserve ordering
                const hasNumber = rawChapter !== null && rawChapter !== undefined && rawChapter !== '';
                const chapterNum = hasNumber ? parseFloat(rawChapter) : null;

                chapters.push({
                    id: chapter.id,
                    chapter: chapterNum,
                    title: attributes.title || (hasNumber ? `Chapter ${rawChapter}` : 'Oneshot'),
                    volume: attributes.volume || null,
                    pages: parseInt(attributes.pages) || 0,
                    uploadedAt: attributes.updatedAt || new Date().toISOString(),
                    source: 'mangadex'
                });
            } catch (e) {
                console.debug('Chapter parse error:', e);
            }
        });

        // Sort: numbered chapters by number, then unnumbered at end by upload date
        return chapters.sort((a, b) => {
            if (a.chapter !== null && b.chapter !== null) return a.chapter - b.chapter;
            if (a.chapter !== null) return -1;
            if (b.chapter !== null) return 1;
            return new Date(a.uploadedAt) - new Date(b.uploadedAt);
        });
    }

    /**
     * Parse page list from API response
     */
    static parsePageList(data) {
        const pages = [];

        try {
            const baseUrl = data.baseUrl || '';
            const chapterHash = data.chapter?.hash || '';
            const pageFilenames = data.chapter?.data || [];

            pageFilenames.forEach((filename, index) => {
                pages.push({
                    page: index + 1,
                    url: `${baseUrl}/data/${chapterHash}/${filename}`
                });
            });
        } catch (e) {
            console.error('Page list parse error:', e);
        }

        return pages;
    }

    /**
     * Get popular/trending manga (ordered by followed count)
     */
    static async getPopular(limit = 20) {
        try {
            const params = new URLSearchParams();
            params.set('limit', String(limit));
            params.append('includes[]', 'cover_art');
            params.append('contentRating[]', 'safe');
            params.append('contentRating[]', 'suggestive');
            params.set('order[followedCount]', 'desc');
            params.set('hasAvailableChapters', 'true');
            params.append('availableTranslatedLanguage[]', 'en');

            const url = `${MANGADEX_API}/manga?${params.toString()}`;
            const data = await http.getJSON(url);
            const results = this.parseSearchResults(data);
            return await this._attachStatistics(results);
        } catch (error) {
            console.error('MangaDex popular error:', error);
            return [];
        }
    }

    /**
     * Get recently updated manga
     */
    static async getRecentlyUpdated(limit = 15) {
        try {
            const params = new URLSearchParams();
            params.set('limit', String(limit));
            params.append('includes[]', 'cover_art');
            params.append('contentRating[]', 'safe');
            params.append('contentRating[]', 'suggestive');
            params.set('order[latestUploadedChapter]', 'desc');
            params.set('hasAvailableChapters', 'true');
            params.append('availableTranslatedLanguage[]', 'en');

            const url = `${MANGADEX_API}/manga?${params.toString()}`;
            const data = await http.getJSON(url);
            const results = this.parseSearchResults(data);
            return await this._attachStatistics(results);
        } catch (error) {
            console.error('MangaDex recent error:', error);
            return [];
        }
    }

    /**
     * Get manga details
     */
    static async getDetails(mangaId) {
        try {
            const params = new URLSearchParams();
            params.append('includes[]', 'cover_art');
            params.append('includes[]', 'author');
            params.append('includes[]', 'artist');

            const url = `${MANGADEX_API}/manga/${mangaId}?${params.toString()}`;
            const data = await http.getJSON(url);
            const manga = data.data;
            const attributes = manga.attributes || {};

            return {
                id: manga.id,
                title: this._getTitle(attributes),
                description: attributes.description?.en || '',
                chapters: attributes.lastChapter ? parseInt(attributes.lastChapter) : null,
                status: attributes.status || 'ongoing',
                year: attributes.year || null,
                contentRating: attributes.contentRating || 'safe',
                tags: attributes.tags?.map(t => t.attributes?.name?.en || '').filter(Boolean) || [],
                source: 'mangadex'
            };
        } catch (error) {
            console.error('MangaDex details fetch error:', error);
            return null;
        }
    }
}
