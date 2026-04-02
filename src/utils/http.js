/**
 * HTTP Utility - Uses Capacitor HTTP plugin for native requests (bypasses CORS)
 * Falls back to fetch() if plugin unavailable
 */

class HttpClient {
    constructor() {
        this._plugin = null;
        this._ready = false;
    }

    _getPlugin() {
        if (this._plugin) return this._plugin;
        try {
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Http) {
                this._plugin = window.Capacitor.Plugins.Http;
            }
        } catch (e) {
            console.warn('[HTTP] Capacitor Http plugin not available, using fetch');
        }
        this._ready = true;
        return this._plugin;
    }

    /**
     * Make a GET request. Uses native HTTP plugin when available (no CORS issues).
     * @param {string} url 
     * @param {object} headers
     * @returns {Promise<{data: string, status: number}>}
     */
    async get(url, headers = {}) {
        const plugin = this._getPlugin();

        if (plugin) {
            try {
                const resp = await plugin.request({
                    method: 'GET',
                    url,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        ...headers
                    }
                });
                return {
                    data: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data),
                    status: resp.status,
                    json: typeof resp.data === 'object' ? resp.data : null
                };
            } catch (e) {
                console.error('[HTTP] Native request failed:', e);
                throw e;
            }
        }

        // Fallback to fetch (works for APIs with CORS headers like MangaDex)
        const resp = await fetch(url, { headers });
        const text = await resp.text();
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        return { data: text, status: resp.status, json };
    }

    /**
     * GET request returning parsed JSON
     */
    async getJSON(url, headers = {}) {
        const result = await this.get(url, headers);
        if (result.json) return result.json;
        return JSON.parse(result.data);
    }

    /**
     * GET request returning HTML text
     */
    async getHTML(url, headers = {}) {
        const result = await this.get(url, {
            'Accept': 'text/html,application/xhtml+xml',
            ...headers
        });
        return result.data;
    }
}

export const http = new HttpClient();
