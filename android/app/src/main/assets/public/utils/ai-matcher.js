/**
 * AI-Powered Title Matcher
 * Uses NVIDIA GLM5 API for intelligent anime/manga title matching
 * with DuckDuckGo search for internet-assisted disambiguation.
 * Maintains a shared match cache so resolved matches benefit all users.
 */

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'z-ai/glm5';

// API key loaded from localStorage at runtime — never hardcoded
const AI_KEY_STORAGE = 'anivault_ai_api_key';

const DDG_SEARCH_URL = 'https://api.duckduckgo.com/';
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';

// In-memory + localStorage cache for resolved matches
const CACHE_KEY = 'anivault_match_cache';
const CACHE_VERSION = 1;
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

class AIMatcher {
    constructor() {
        this._cache = null;
        this._pendingRequests = new Map(); // dedup concurrent identical requests
    }

    // ─── Cache System ───────────────────────────────────────────────

    _loadCache() {
        if (this._cache) return this._cache;
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.version === CACHE_VERSION) {
                    // Prune expired entries
                    const now = Date.now();
                    for (const [key, entry] of Object.entries(parsed.matches)) {
                        if (now - entry.timestamp > CACHE_MAX_AGE) {
                            delete parsed.matches[key];
                        }
                    }
                    this._cache = parsed;
                    return this._cache;
                }
            }
        } catch (e) {
            console.warn('[AIMatcher] Cache load failed:', e.message);
        }
        this._cache = { version: CACHE_VERSION, matches: {} };
        return this._cache;
    }

    _saveCache() {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(this._cache));
        } catch (e) {
            console.warn('[AIMatcher] Cache save failed:', e.message);
        }
    }

    _getCacheKey(query, candidates, type) {
        const cKey = candidates.map(c => (c.title || '').toLowerCase().trim()).sort().join('|');
        return `${type}:${query.toLowerCase().trim()}::${cKey}`;
    }

    getCachedMatch(query, candidates, type = 'anime') {
        const cache = this._loadCache();
        const key = this._getCacheKey(query, candidates, type);
        const entry = cache.matches[key];
        if (entry && (Date.now() - entry.timestamp < CACHE_MAX_AGE)) {
            console.log(`[AIMatcher] Cache hit for "${query}" → "${entry.matchedTitle}"`);
            return entry;
        }
        return null;
    }

    _setCachedMatch(query, candidates, type, matchedIndex, matchedTitle, confidence, method) {
        const cache = this._loadCache();
        const key = this._getCacheKey(query, candidates, type);
        cache.matches[key] = {
            matchedIndex,
            matchedTitle,
            confidence,
            method, // 'ai', 'ddg', 'ai+ddg'
            timestamp: Date.now()
        };
        this._saveCache();
        console.log(`[AIMatcher] Cached: "${query}" → "${matchedTitle}" (${method}, ${confidence}%)`);
    }

    // ─── DuckDuckGo Search ──────────────────────────────────────────

    /**
     * Search DuckDuckGo for title disambiguation.
     * Returns relevant info like official English title, MAL link, etc.
     */
    async searchDDG(query) {
        try {
            // Try Instant Answer API first (structured data)
            const iaUrl = `${DDG_SEARCH_URL}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            const resp = await this._fetchJSON(iaUrl);

            if (resp && (resp.Abstract || resp.RelatedTopics?.length > 0)) {
                return {
                    abstract: resp.Abstract || '',
                    heading: resp.Heading || '',
                    topics: (resp.RelatedTopics || []).slice(0, 5).map(t => ({
                        text: t.Text || '',
                        url: t.FirstURL || ''
                    })),
                    source: 'ddg_instant'
                };
            }

            // Fallback: scrape HTML search results via native HTTP
            const htmlResults = await this._searchDDGHtml(query);
            if (htmlResults.length > 0) {
                return {
                    abstract: '',
                    heading: query,
                    topics: htmlResults,
                    source: 'ddg_html'
                };
            }

            return null;
        } catch (e) {
            console.warn('[AIMatcher] DDG search failed:', e.message);
            return null;
        }
    }

    async _searchDDGHtml(query) {
        try {
            const plugin = window.Capacitor?.Plugins?.CapacitorHttp || window.Capacitor?.Plugins?.Http;
            if (!plugin) return [];

            const url = `${DDG_HTML_URL}?q=${encodeURIComponent(query)}`;
            const resp = await plugin.request({
                method: 'GET',
                url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
                }
            });

            if (!resp.data) return [];
            const html = typeof resp.data === 'string' ? resp.data : '';

            // Extract search result snippets
            const results = [];
            const snippetRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
            let m;
            while ((m = snippetRegex.exec(html)) !== null && results.length < 5) {
                results.push({
                    url: m[1],
                    title: m[2].replace(/<[^>]+>/g, '').trim(),
                    text: m[3].replace(/<[^>]+>/g, '').trim()
                });
            }
            return results;
        } catch (e) {
            console.warn('[AIMatcher] DDG HTML search failed:', e.message);
            return [];
        }
    }

    async _fetchJSON(url) {
        try {
            const resp = await fetch(url);
            return await resp.json();
        } catch (e) {
            // Try native HTTP if fetch fails (CORS)
            try {
                const plugin = window.Capacitor?.Plugins?.CapacitorHttp || window.Capacitor?.Plugins?.Http;
                if (!plugin) return null;
                const nativeResp = await plugin.request({ method: 'GET', url, headers: {} });
                return typeof nativeResp.data === 'object' ? nativeResp.data : JSON.parse(nativeResp.data);
            } catch (_) {
                return null;
            }
        }
    }

    // ─── NVIDIA AI Matching ─────────────────────────────────────────

    /**
     * Ask NVIDIA GLM5 to pick the best match from candidates.
     * @param {string} query - The title we're looking for
     * @param {Array} candidates - Array of {title, source, episodes/chapters, type}
     * @param {string} contentType - 'anime' or 'manga'
     * @param {object} context - Extra context (expectedEps, season, genres, ddgInfo)
     * @returns {object|null} { index, confidence, reasoning }
     */
    async askAI(query, candidates, contentType = 'anime', context = {}) {
        if (!candidates || candidates.length === 0) return null;

        // Load API key from localStorage — skip AI if not configured
        const apiKey = localStorage.getItem(AI_KEY_STORAGE);
        if (!apiKey) {
            console.log('[AIMatcher] No API key configured, skipping AI matching');
            return null;
        }

        // Build candidate list for the prompt
        const candidateList = candidates.map((c, i) => {
            const parts = [`${i + 1}. "${c.title}"`];
            if (c.titleEnglish) parts.push(`(English: "${c.titleEnglish}")`);
            if (c.source) parts.push(`[${c.source}]`);
            if (contentType === 'anime') {
                if (c.episodes?.sub) parts.push(`${c.episodes.sub} eps`);
                if (c.animeType) parts.push(`(${c.animeType})`);
            } else {
                if (c.chapters) parts.push(`${c.chapters} chapters`);
            }
            return parts.join(' ');
        }).join('\n');

        // Build context info
        let contextStr = '';
        if (context.expectedEps) contextStr += `\nExpected episodes: ${context.expectedEps}`;
        if (context.season) contextStr += `\nSeason number: ${context.season}`;
        if (context.genres) contextStr += `\nGenres: ${context.genres}`;
        if (context.ddgInfo) {
            contextStr += `\nInternet search info: ${context.ddgInfo}`;
        }

        const prompt = `You are an anime/manga title matching expert. Given a search query and a numbered list of candidates, pick the BEST match.

Search query: "${query}"
Content type: ${contentType}
${contextStr}

Candidates:
${candidateList}

Rules:
- Japanese romaji titles and English titles for the same series are valid matches (e.g. "Sono Bisque Doll wa Koi o Suru" = "My Dress-Up Darling")
- Season numbers matter: "Title Season 2" should match "Title 2nd Season" but NOT "Title" (season 1)
- If NO candidate is a good match, respond with 0
- Consider alternate spellings, romanizations, and common title variations

Respond with ONLY a JSON object (no markdown): {"pick": <number 1-N or 0>, "confidence": <0-100>, "reason": "<brief reason>"}`;

        try {
            const body = {
                model: NVIDIA_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,  // Low temp for deterministic matching
                top_p: 0.9,
                max_tokens: 256,
                stream: false
            };

            // Use native HTTP to avoid CORS issues
            const plugin = window.Capacitor?.Plugins?.CapacitorHttp || window.Capacitor?.Plugins?.Http;
            let responseText;

            if (plugin) {
                const resp = await plugin.request({
                    method: 'POST',
                    url: NVIDIA_API_URL,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    data: body
                });
                const data = typeof resp.data === 'object' ? resp.data : JSON.parse(resp.data);
                responseText = data.choices?.[0]?.message?.content || '';
            } else {
                // Fetch fallback
                const resp = await fetch(NVIDIA_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(body)
                });
                const data = await resp.json();
                responseText = data.choices?.[0]?.message?.content || '';
            }

            // Parse AI response
            const parsed = this._parseAIResponse(responseText);
            if (parsed && parsed.pick >= 0 && parsed.pick <= candidates.length) {
                console.log(`[AIMatcher] AI picked #${parsed.pick}: "${candidates[parsed.pick - 1]?.title}" (${parsed.confidence}% - ${parsed.reason})`);
                return {
                    index: parsed.pick - 1,  // 0-based
                    confidence: parsed.confidence,
                    reasoning: parsed.reason
                };
            }

            return null;
        } catch (e) {
            console.warn('[AIMatcher] AI request failed:', e.message);
            return null;
        }
    }

    _parseAIResponse(text) {
        if (!text) return null;
        try {
            // Strip markdown code fences if present
            const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
            const parsed = JSON.parse(cleaned);
            return {
                pick: parseInt(parsed.pick) || 0,
                confidence: parseInt(parsed.confidence) || 0,
                reason: String(parsed.reason || '')
            };
        } catch (e) {
            // Try to extract numbers from text
            const pickMatch = text.match(/"pick"\s*:\s*(\d+)/);
            const confMatch = text.match(/"confidence"\s*:\s*(\d+)/);
            if (pickMatch) {
                return {
                    pick: parseInt(pickMatch[1]),
                    confidence: confMatch ? parseInt(confMatch[1]) : 50,
                    reason: 'parsed from partial response'
                };
            }
            console.warn('[AIMatcher] Failed to parse AI response:', text.substring(0, 200));
            return null;
        }
    }

    // ─── Combined Smart Match ───────────────────────────────────────

    /**
     * Full smart matching pipeline:
     * 1. Check cache
     * 2. If uncertain, search DDG for context
     * 3. Ask AI with all available context
     * 4. Cache and return result
     *
     * @param {string} query - Title to match
     * @param {Array} candidates - Search results to match against
     * @param {string} type - 'anime' or 'manga'
     * @param {object} opts - { expectedEps, season, genres, localBestIndex, localBestScore }
     * @returns {object|null} { index, title, confidence, method }
     */
    async smartMatch(query, candidates, type = 'anime', opts = {}) {
        if (!candidates || candidates.length === 0) return null;

        // 1. Check cache
        const cached = this.getCachedMatch(query, candidates, type);
        if (cached) {
            return {
                index: cached.matchedIndex,
                title: cached.matchedTitle,
                confidence: cached.confidence,
                method: 'cache'
            };
        }

        // Dedup: if same request is already in flight, wait for it
        const dedupKey = `${type}:${query}`;
        if (this._pendingRequests.has(dedupKey)) {
            return this._pendingRequests.get(dedupKey);
        }

        const promise = this._doSmartMatch(query, candidates, type, opts);
        this._pendingRequests.set(dedupKey, promise);
        try {
            return await promise;
        } finally {
            this._pendingRequests.delete(dedupKey);
        }
    }

    async _doSmartMatch(query, candidates, type, opts) {
        let ddgInfo = '';

        // 2. Search DDG for extra context (title disambiguation)
        try {
            const ddgQuery = type === 'anime'
                ? `${query} anime myanimelist`
                : `${query} manga myanimelist`;
            const ddg = await Promise.race([
                this.searchDDG(ddgQuery),
                new Promise((_, rej) => setTimeout(() => rej(new Error('DDG timeout')), 5000))
            ]);

            if (ddg) {
                const snippets = [];
                if (ddg.abstract) snippets.push(ddg.abstract);
                if (ddg.heading && ddg.heading !== query) snippets.push(`Heading: ${ddg.heading}`);
                for (const t of (ddg.topics || []).slice(0, 3)) {
                    if (t.text) snippets.push(t.text.substring(0, 150));
                }
                ddgInfo = snippets.join(' | ').substring(0, 500);
            }
        } catch (e) {
            console.warn('[AIMatcher] DDG context search failed:', e.message);
        }

        // 3. Ask AI
        const context = {
            expectedEps: opts.expectedEps,
            season: opts.season,
            genres: opts.genres,
            ddgInfo: ddgInfo || undefined
        };

        const aiResult = await this.askAI(query, candidates, type, context);

        if (aiResult && aiResult.index >= 0 && aiResult.index < candidates.length && aiResult.confidence >= 40) {
            const matched = candidates[aiResult.index];
            this._setCachedMatch(
                query, candidates, type,
                aiResult.index,
                matched.title,
                aiResult.confidence,
                ddgInfo ? 'ai+ddg' : 'ai'
            );
            return {
                index: aiResult.index,
                title: matched.title,
                confidence: aiResult.confidence,
                method: ddgInfo ? 'ai+ddg' : 'ai'
            };
        }

        // AI said no good match (pick=0) or failed — return null
        return null;
    }

    // ─── Public API for Coordinator ─────────────────────────────────

    /**
     * Enhanced anime matching: use local scoring first, fall back to AI if uncertain.
     */
    async enhancedAnimeMatch(results, title, expectedEps = null, localBest = null, localBestScore = 0) {
        // If local matching is confident (score >= 80), trust it
        if (localBest && localBestScore >= 80) {
            return localBest;
        }

        // If we have candidates, ask AI
        if (results && results.length > 0) {
            const seasonMatch = title.match(/(?:\s+(\d)$|\s+season\s*(\d+)|\s+(\d+)(?:st|nd|rd|th)\s+season)/i);
            const season = seasonMatch ? parseInt(seasonMatch[1] || seasonMatch[2] || seasonMatch[3]) : null;

            const aiMatch = await this.smartMatch(title, results, 'anime', {
                expectedEps,
                season,
                localBestIndex: localBest ? results.indexOf(localBest) : -1,
                localBestScore
            });

            if (aiMatch && aiMatch.index >= 0) {
                console.log(`[AIMatcher] AI override: "${title}" → "${aiMatch.title}" (was: "${localBest?.title || 'none'}", method: ${aiMatch.method})`);
                return results[aiMatch.index];
            }
        }

        // Fall back to local best if AI didn't help
        return localBest;
    }

    /**
     * Enhanced manga matching: use local scoring first, fall back to AI if uncertain.
     */
    async enhancedMangaMatch(results, title, localBest = null, localBestScore = 0) {
        if (localBest && localBestScore >= 80) {
            return localBest;
        }

        if (results && results.length > 0) {
            const aiMatch = await this.smartMatch(title, results, 'manga', {
                localBestIndex: localBest ? results.indexOf(localBest) : -1,
                localBestScore
            });

            if (aiMatch && aiMatch.index >= 0) {
                console.log(`[AIMatcher] AI manga override: "${title}" → "${aiMatch.title}" (was: "${localBest?.title || 'none'}")`);
                return results[aiMatch.index];
            }
        }

        return localBest;
    }
}

export const aiMatcher = new AIMatcher();
