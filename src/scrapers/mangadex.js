/**
 * MangaDex Scraper
 * Uses official MangaDex REST API v5 (no scraping needed)
 * Much more reliable than HTML scraping
 */

const MANGADEX_API = 'https://api.mangadex.org';

export class MangaDexScraper {
    /**
     * Search for manga on MangaDex
     */
    static async search(query) {
        try {
            const url = new URL(`${MANGADEX_API}/manga`);
            url.searchParams.set('title', query);
            url.searchParams.set('limit', '15');
            url.searchParams.set('includes[]', 'cover_art');
            url.searchParams.set('contentRating[]', 'safe');
            url.searchParams.set('contentRating[]', 'suggestive');
            url.searchParams.set('contentRating[]', 'erotica');

            const response = await fetch(url.toString());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
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
            const url = new URL(`${MANGADEX_API}/manga/${mangaId}/feed`);
            url.searchParams.set('limit', '100');
            url.searchParams.set('order[chapter]', 'asc');
            url.searchParams.set('translatedLanguage[]', 'en');

            const response = await fetch(url.toString());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
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
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
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
                    title: attributes.title?.en || attributes.title?.ja || 'Unknown',
                    coverImage: coverUrl,
                    description: attributes.description?.en || '',
                    chapters: attributes.lastChapter ? parseInt(attributes.lastChapter) : null,
                    url: `${MANGADEX_API}/manga/${manga.id}`,
                    source: 'mangadex'
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
            const url = new URL(`${MANGADEX_API}/manga/${mangaId}`);
            url.searchParams.set('includes[]', 'cover_art');
            url.searchParams.set('includes[]', 'author');
            url.searchParams.set('includes[]', 'artist');

            const response = await fetch(url.toString());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const manga = data.data;
            const attributes = manga.attributes || {};

            return {
                id: manga.id,
                title: attributes.title?.en || attributes.title?.ja || 'Unknown',
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
