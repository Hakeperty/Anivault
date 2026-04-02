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
        // Fallback: first available value
        const vals = Object.values(t);
        return vals.length > 0 ? vals[0] : 'Unknown';
    }

    /**
     * Search for manga on MangaDex
     */
    static async search(query) {
        try {
            const params = new URLSearchParams();
            params.set('title', query);
            params.set('limit', '15');
            params.append('includes[]', 'cover_art');
            params.append('contentRating[]', 'safe');
            params.append('contentRating[]', 'suggestive');
            params.append('contentRating[]', 'erotica');

            const url = `${MANGADEX_API}/manga?${params.toString()}`;
            const data = await http.getJSON(url);
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('MangaDex search error:', error);
            return [];
        }
    }

    /**
     * Get chapter list for a manga
     */
    static async getChapters(mangaId) {
        try {
            const params = new URLSearchParams();
            params.set('limit', '100');
            params.set('order[chapter]', 'asc');
            params.append('translatedLanguage[]', 'en');

            const url = `${MANGADEX_API}/manga/${mangaId}/feed?${params.toString()}`;
            const data = await http.getJSON(url);
            return this.parseChapterList(data);
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
                    url: `${MANGADEX_API}/manga/${manga.id}`,
                    source: 'mangadex',
                    type: 'manga'
                });
            } catch (e) {
                console.debug('Parse error on manga:', e);
            }
        });

        return results;
    }

    /**
     * Parse chapter list from API response
     */
    static parseChapterList(data) {
        const chapters = [];

        data.data?.forEach(chapter => {
            try {
                const attributes = chapter.attributes || {};
                const chapterNum = parseFloat(attributes.chapter) || 0;

                chapters.push({
                    id: chapter.id,
                    chapter: chapterNum,
                    title: attributes.title || `Chapter ${chapterNum}`,
                    volume: attributes.volume || null,
                    pages: parseInt(attributes.pages) || 0,
                    uploadedAt: attributes.updatedAt || new Date().toISOString()
                });
            } catch (e) {
                console.debug('Chapter parse error:', e);
            }
        });

        return chapters.sort((a, b) => a.chapter - b.chapter);
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
