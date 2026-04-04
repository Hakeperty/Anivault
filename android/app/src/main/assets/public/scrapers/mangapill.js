/**
 * MangaPill Scraper
 * Backup manga source with clean direct-image CDN URLs.
 * Works with both English and Japanese title searches.
 */

import { http } from '../utils/http.js';

const MANGAPILL_BASE = 'https://mangapill.com';

export class MangaPillScraper {
    static async search(query) {
        try {
            const url = `${MANGAPILL_BASE}/search?q=${encodeURIComponent(query)}`;
            const html = await http.getHTML(url);
            return this.parseSearchResults(html);
        } catch (error) {
            console.error('MangaPill search error:', error);
            return [];
        }
    }

    static async getChapters(mangaUrl) {
        try {
            const fullUrl = mangaUrl.startsWith('http') ? mangaUrl : `${MANGAPILL_BASE}${mangaUrl}`;
            const html = await http.getHTML(fullUrl);
            return this.parseChapterList(html);
        } catch (error) {
            console.error('MangaPill chapter fetch error:', error);
            return [];
        }
    }

    static async getPages(chapterUrl) {
        try {
            const fullUrl = chapterUrl.startsWith('http') ? chapterUrl : `${MANGAPILL_BASE}${chapterUrl}`;
            const html = await http.getHTML(fullUrl);
            return this.parsePages(html);
        } catch (error) {
            console.error('MangaPill pages fetch error:', error);
            return [];
        }
    }

    /**
     * Parse search results.
     * Structure: .container grid with manga cards containing title + cover + link
     */
    static parseSearchResults(html) {
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Each result is an anchor with manga link + image + title
        const cards = doc.querySelectorAll('a[href*="/manga/"]');
        const seen = new Set();

        cards.forEach(card => {
            try {
                const href = card.getAttribute('href') || '';
                if (!href.match(/\/manga\/\d+\//)) return;
                if (seen.has(href)) return;
                seen.add(href);

                const img = card.querySelector('img');
                const titleDiv = card.querySelector('div.font-bold, div.leading-tight, .mt-1');
                const title = titleDiv?.textContent?.trim() ||
                    img?.getAttribute('alt')?.trim() || '';
                if (!title) return;

                const coverUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
                const idMatch = href.match(/\/manga\/(\d+)\//);
                const id = idMatch ? idMatch[1] : href;

                results.push({
                    id: `mangapill-${id}`,
                    title,
                    coverImage: coverUrl,
                    url: href.startsWith('http') ? href : `${MANGAPILL_BASE}${href}`,
                    source: 'mangapill',
                    type: 'manga',
                    description: '',
                    genres: []
                });
            } catch (e) {
                console.debug('MangaPill parse error:', e);
            }
        });

        return results;
    }

    /**
     * Parse chapter list from manga detail page.
     * Chapters are links matching /chapters/{id}-{num}/{slug}-chapter-{num}
     */
    static parseChapterList(html) {
        const chapters = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const chapterLinks = doc.querySelectorAll('a[href*="/chapters/"]');
        const seen = new Set();

        chapterLinks.forEach(link => {
            try {
                const href = link.getAttribute('href') || '';
                const text = link.textContent.trim();
                const numMatch = text.match(/chapter\s*([\d.]+)/i) || href.match(/chapter-([\d.]+)/);
                if (!numMatch) return;

                const chapterNum = parseFloat(numMatch[1]);
                if (seen.has(chapterNum)) return;
                seen.add(chapterNum);

                const chapterUrl = href.startsWith('http') ? href : `${MANGAPILL_BASE}${href}`;

                chapters.push({
                    id: chapterUrl,
                    chapter: chapterNum,
                    url: chapterUrl,
                    title: text || `Chapter ${chapterNum}`,
                    source: 'mangapill'
                });
            } catch (e) {
                console.debug('MangaPill chapter parse error:', e);
            }
        });

        return chapters.sort((a, b) => a.chapter - b.chapter);
    }

    /**
     * Parse page images from chapter reader.
     * MangaPill serves images directly as <img> tags with CDN URLs.
     */
    static parsePages(html) {
        const pages = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Primary: img tags with chapter page images (CDN URLs)
        const imgs = doc.querySelectorAll('chapter-page img, img[chapter-page], .container--reader img');
        if (imgs.length > 0) {
            imgs.forEach((img, index) => {
                const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
                if (src && src.startsWith('http')) {
                    pages.push({ page: index + 1, url: src });
                }
            });
        }

        // Fallback: find all img tags with CDN-like URLs
        if (pages.length === 0) {
            const allImgs = doc.querySelectorAll('img');
            allImgs.forEach((img, index) => {
                const src = img.getAttribute('src') || '';
                // MangaPill CDN pattern: cdn.readdetectiveconan.com or similar
                if (src.match(/\/file\/mangap?\//i) ||
                    src.match(/cdn\.[^/]+\/file\//i) ||
                    src.match(/\/\d+\/\d+\/\d+\.(jpg|png|webp)$/i)) {
                    pages.push({ page: pages.length + 1, url: src });
                }
            });
        }

        return pages;
    }
}
