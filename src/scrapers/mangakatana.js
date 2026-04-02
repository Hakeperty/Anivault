/**
 * MangaKatana Scraper
 * Fallback manga source for when MangaDex is unavailable
 * Uses Capacitor native HTTP to bypass CORS restrictions.
 */

import { http } from '../utils/http.js';

const MANGAKATANA_BASE = 'https://mangakatana.com';

export class MangaKatanaScraper {
    static async search(query) {
        try {
            const searchUrl = `${MANGAKATANA_BASE}/?search=${encodeURIComponent(query)}&search_type=manga_name`;
            const html = await http.getHTML(searchUrl);
            return this.parseSearchResults(html);
        } catch (error) {
            console.error('MangaKatana search error:', error);
            return [];
        }
    }

    static async getChapters(mangaUrl) {
        try {
            const fullUrl = mangaUrl.startsWith('http') ? mangaUrl : `${MANGAKATANA_BASE}${mangaUrl}`;
            const html = await http.getHTML(fullUrl);
            return this.parseChapterList(html);
        } catch (error) {
            console.error('MangaKatana chapter fetch error:', error);
            return [];
        }
    }

    static async getPages(chapterUrl) {
        try {
            const fullUrl = chapterUrl.startsWith('http') ? chapterUrl : `${MANGAKATANA_BASE}${chapterUrl}`;
            const html = await http.getHTML(fullUrl);
            return this.parsePages(html);
        } catch (error) {
            console.error('MangaKatana pages fetch error:', error);
            return [];
        }
    }

    /**
     * Parse search results HTML
     */
    static parseSearchResults(html) {
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const items = doc.querySelectorAll('.item.manga, .manga-item, [data-manga-id]');

        items.forEach(item => {
            try {
                const linkEl = item.querySelector('a[href*="/manga/"]');
                const titleEl = item.querySelector('h3 a, .title a, a[title]');
                const coverEl = item.querySelector('img, [data-src]');

                if (titleEl && linkEl) {
                    results.push({
                        id: linkEl.href.split('/').filter(Boolean).pop(),
                        title: titleEl.textContent.trim() || titleEl.getAttribute('title'),
                        coverImage: coverEl?.src || coverEl?.getAttribute('data-src') || '',
                        url: linkEl.href,
                        source: 'mangakatana'
                    });
                }
            } catch (e) {
                console.debug('Parse error on item:', e);
            }
        });

        return results;
    }

    /**
     * Parse chapter list HTML
     */
    static parseChapterList(html) {
        const chapters = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const chapterLinks = doc.querySelectorAll('a.chapter, .chapter-item a, [href*="/chapter/"]');

        chapterLinks.forEach((link, index) => {
            try {
                const text = link.textContent.trim();
                const numMatch = text.match(/chapter\s*(\d+(?:\.\d+)?)/i);
                const chapterNum = numMatch ? parseFloat(numMatch[1]) : (index + 1);

                chapters.push({
                    chapter: chapterNum,
                    url: link.href.startsWith('http') ? link.href : `${MANGAKATANA_BASE}${link.href}`,
                    title: text
                });
            } catch (e) {
                console.debug('Chapter parse error:', e);
            }
        });

        return chapters.sort((a, b) => a.chapter - b.chapter);
    }

    /**
     * Parse page list HTML
     */
    static parsePages(html) {
        const pages = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Look for page images in reader
        const pageImages = doc.querySelectorAll('img.page, img[data-page], #manga-page img, .reader img');

        pageImages.forEach((img, index) => {
            try {
                const src = img.src || img.getAttribute('data-src');
                if (src) {
                    pages.push({
                        page: index + 1,
                        url: src.startsWith('http') ? src : `${MANGAKATANA_BASE}${src}`
                    });
                }
            } catch (e) {
                console.debug('Page parse error:', e);
            }
        });

        return pages;
    }
}
