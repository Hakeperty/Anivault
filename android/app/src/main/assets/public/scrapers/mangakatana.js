/**
 * MangaKatana Scraper
 * Fallback manga source for when MangaDex is unavailable.
 * Uses Capacitor native HTTP to bypass CORS restrictions.
 *
 * Key site patterns (as of 2026):
 *  - Search results: div#book_list > div.item with .wrap_img img, h3.title a
 *  - Chapter list: select.chapter_select > option (value = chapter slug)
 *  - Page images: embedded in <script> as `var thzq=[...image URLs...]`
 */

import { http } from '../utils/http.js';

const MANGAKATANA_BASE = 'https://mangakatana.com';

export class MangaKatanaScraper {
    static async search(query) {
        try {
            // Try m_name first (manga name search)
            const mNameUrl = `${MANGAKATANA_BASE}/?search=${encodeURIComponent(query)}&search_by=m_name`;
            const html = await http.getHTML(mNameUrl);
            let results = this.parseSearchResults(html);

            // If no results, try book_name (broader search, better for English titles)
            if (results.length === 0) {
                const bookUrl = `${MANGAKATANA_BASE}/?search=${encodeURIComponent(query)}&search_by=book_name`;
                const html2 = await http.getHTML(bookUrl);
                results = this.parseSearchResults(html2);
            }

            return results;
        } catch (error) {
            console.error('MangaKatana search error:', error);
            return [];
        }
    }

    static async getChapters(mangaUrl) {
        try {
            const fullUrl = mangaUrl.startsWith('http') ? mangaUrl : `${MANGAKATANA_BASE}${mangaUrl}`;
            const html = await http.getHTML(fullUrl);
            return this.parseChapterList(html, fullUrl);
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
     * Parse search results HTML from MangaKatana.
     * Structure: #book_list > .item > .media/.text
     */
    static parseSearchResults(html) {
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Primary: #book_list > .item
        let items = doc.querySelectorAll('#book_list .item');
        // Fallback selectors
        if (!items.length) {
            items = doc.querySelectorAll('.item.manga, .manga-item, [data-manga-id], div[data-id]');
        }

        items.forEach(item => {
            try {
                const titleEl = item.querySelector('h3.title a, .title a, h3 a');
                const coverEl = item.querySelector('.wrap_img img, .media img, img');
                const linkEl = titleEl || item.querySelector('a[href*="/manga/"]');
                const summaryEl = item.querySelector('.summary');
                const genreEls = item.querySelectorAll('.genres a');

                if (titleEl && linkEl) {
                    const href = linkEl.getAttribute('href') || '';
                    const slug = href.split('/manga/').pop()?.split('/')[0] || '';

                    results.push({
                        id: slug || href,
                        title: titleEl.textContent.trim().split(' - ')[0] || titleEl.getAttribute('title') || '',
                        coverImage: coverEl?.getAttribute('src') || coverEl?.getAttribute('data-src') || '',
                        url: href.startsWith('http') ? href : `${MANGAKATANA_BASE}${href}`,
                        source: 'mangakatana',
                        type: 'manga',
                        description: summaryEl?.textContent?.trim() || '',
                        genres: Array.from(genreEls).map(g => g.textContent.trim()).filter(Boolean)
                    });
                }
            } catch (e) {
                console.debug('MangaKatana parse error on item:', e);
            }
        });

        return results;
    }

    /**
     * Parse chapter list from manga detail page.
     * Chapters are in: select.chapter_select > option
     * And also in: .chapters .chapter a[href]
     */
    static parseChapterList(html, baseUrl = '') {
        const chapters = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const resolvedBaseUrl = baseUrl || doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';

        // Method 1: select.chapter_select options (most reliable on chapter reader pages)
        const selectOptions = doc.querySelectorAll('select.chapter_select option[value]');
        if (selectOptions.length > 0) {
            const mangaUrlBase = resolvedBaseUrl.replace(/\/c[\d.]+$/, '');
            selectOptions.forEach((opt) => {
                const val = opt.getAttribute('value');
                if (!val) return;
                const text = opt.textContent.trim();
                const numMatch = text.match(/chapter\s*([\d.]+)/i);
                const chapterNum = numMatch ? parseFloat(numMatch[1]) : null;
                if (chapterNum === null) return;
                const chapterUrl = val.startsWith('http') ? val : `${mangaUrlBase}/${val}`.replace(/([^:]\/)\/+/g, '$1');
                const chapterId = chapterUrl;

                chapters.push({
                    id: chapterId,
                    chapter: chapterNum,
                    url: chapterUrl,
                    title: text,
                    source: 'mangakatana'
                });
            });
        }

        // Method 2: chapter links on the manga detail page
        if (chapters.length === 0) {
            const chapterLinks = doc.querySelectorAll('.chapters a[href*="/c"], .chapter a[href*="/c"], a[href*="/manga/"][href*="/c"]');
            chapterLinks.forEach((link) => {
                try {
                    const href = link.getAttribute('href') || '';
                    const text = link.textContent.trim();
                    const numMatch = text.match(/chapter\s*([\d.]+)/i) || href.match(/\/c([\d.]+)$/);
                    const chapterNum = numMatch ? parseFloat(numMatch[1]) : null;
                    if (chapterNum === null) return;
                    // Avoid duplicates
                    if (chapters.some(c => c.chapter === chapterNum)) return;
                    const chapterUrl = href.startsWith('http') ? href : `${MANGAKATANA_BASE}${href}`;
                    const chapterId = chapterUrl;

                    chapters.push({
                        id: chapterId,
                        chapter: chapterNum,
                        url: chapterUrl,
                        title: text || `Chapter ${chapterNum}`,
                        source: 'mangakatana'
                    });
                } catch (e) {
                    console.debug('Chapter parse error:', e);
                }
            });
        }

        return chapters.sort((a, b) => a.chapter - b.chapter);
    }

    /**
     * Parse page images from chapter reader page.
     * MangaKatana loads images via JS: `var thzq=[...URLs...]`
     * The DOM only contains `data-src="#"` placeholders.
     */
    static parsePages(html) {
        const pages = [];

        // Method 1: Extract from `var thzq=[...]` JavaScript array (primary method)
        const thzqMatch = html.match(/var\s+thzq\s*=\s*\[([^\]]+)\]/);
        if (thzqMatch) {
            const urlsStr = thzqMatch[1];
            const urls = urlsStr.match(/'([^']+)'/g) || urlsStr.match(/"([^"]+)"/g) || [];
            urls.forEach((urlQuoted, index) => {
                const url = urlQuoted.replace(/^['"]|['"]$/g, '');
                if (url && url.startsWith('http')) {
                    pages.push({ page: index + 1, url });
                }
            });
        }

        // Method 2: Try `var ytaw=[...]` (alternate variable name)
        if (pages.length === 0) {
            const ytawMatch = html.match(/var\s+ytaw\s*=\s*\[([^\]]+)\]/);
            if (ytawMatch) {
                const urlsStr = ytawMatch[1];
                const urls = urlsStr.match(/'([^']+)'/g) || urlsStr.match(/"([^"]+)"/g) || [];
                urls.forEach((urlQuoted, index) => {
                    const url = urlQuoted.replace(/^['"]|['"]$/g, '');
                    if (url && url.startsWith('http')) {
                        pages.push({ page: index + 1, url });
                    }
                });
            }
        }

        // Method 3: Generic search for any variable containing image URL arrays
        if (pages.length === 0) {
            const genericMatch = html.match(/var\s+\w+\s*=\s*\[((?:\s*'https?:\/\/[^']+'\s*,?\s*)+)\]/);
            if (genericMatch) {
                const urls = genericMatch[1].match(/'(https?:\/\/[^']+)'/g) || [];
                urls.forEach((urlQuoted, index) => {
                    const url = urlQuoted.replace(/^'|'$/g, '');
                    if (url) pages.push({ page: index + 1, url });
                });
            }
        }

        // Method 4: Fallback to DOM parsing (for non-JS-rendered pages)
        if (pages.length === 0) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const pageImages = doc.querySelectorAll('#imgs .wrap_img img, img.page, img[data-page], #manga-page img, .reader img');
            pageImages.forEach((img, index) => {
                const src = img.getAttribute('data-src') || img.getAttribute('src');
                if (src && src !== '#' && src.startsWith('http')) {
                    pages.push({
                        page: index + 1,
                        url: src
                    });
                }
            });
        }

        return pages;
    }
}
