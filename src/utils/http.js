/**
 * HTTP Utility - Uses Capacitor HTTP plugin for native requests (bypasses CORS)
 * Falls back to fetch() if plugin unavailable (works for CORS-enabled APIs)
 */

class HttpClient {
    constructor() {
        this._plugin = null;
        this._pluginChecked = false;
    }

    _getPlugin() {
        if (this._pluginChecked) return this._plugin;
        this._pluginChecked = true;
        try {
            // Capacitor 5 built-in CapacitorHttp (enabled via config)
            if (window.Capacitor?.Plugins?.CapacitorHttp) {
                this._plugin = window.Capacitor.Plugins.CapacitorHttp;
                console.log('[HTTP] Using Capacitor 5 built-in HTTP plugin');
            }
            // @capacitor-community/http fallback
            else if (window.Capacitor?.Plugins?.Http) {
                this._plugin = window.Capacitor.Plugins.Http;
                console.log('[HTTP] Using Capacitor community HTTP plugin');
            }
        } catch (e) {
            console.warn('[HTTP] Capacitor Http plugin not available, using fetch');
        }
        return this._plugin;
    }

    /**
     * Make a GET request with timeout. Uses native HTTP when available.
     */
    async get(url, headers = {}, timeoutMs = 15000) {
        const plugin = this._getPlugin();

        const urlObj = new URL(url);
        const defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Referer': `${urlObj.protocol}//${urlObj.hostname}/`,
            'Accept-Language': 'en-US,en;q=0.9',
        };
        const mergedHeaders = { ...defaultHeaders, ...headers };

        if (plugin) {
            try {
                const resp = await this._withTimeout(
                    plugin.request({ method: 'GET', url, headers: mergedHeaders }),
                    timeoutMs,
                    `Native request to ${urlObj.hostname}`
                );
                return {
                    data: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data),
                    status: resp.status,
                    json: typeof resp.data === 'object' ? resp.data : null
                };
            } catch (e) {
                console.warn('[HTTP] Native request failed for', urlObj.hostname, ':', e.message || e);
                // Fall through to fetch for CORS-friendly APIs
                if (this._isCorsApi(url)) {
                    console.log('[HTTP] Trying fetch fallback for CORS API:', urlObj.hostname);
                } else {
                    throw e;
                }
            }
        }

        // Fallback to fetch (works for CORS-enabled APIs: Jikan, MangaDex)
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { headers: mergedHeaders, signal: controller.signal });
            const text = await resp.text();
            let json = null;
            try { json = JSON.parse(text); } catch (_) {}
            return { data: text, status: resp.status, json };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * GET request returning parsed JSON
     */
    async getJSON(url, headers = {}) {
        const result = await this.get(url, {
            'Accept': 'application/json',
            ...headers
        });
        if (result.json) return result.json;
        try {
            return JSON.parse(result.data);
        } catch (e) {
            console.error('[HTTP] JSON parse failed for', url, '- data:', result.data?.substring?.(0, 200));
            throw e;
        }
    }

    /**
     * GET request returning HTML text
     */
    async getHTML(url, headers = {}) {
        const result = await this.get(url, {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            ...headers
        });
        return result.data;
    }

    /** Wrap a promise with a timeout */
    _withTimeout(promise, ms, label = '') {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
            promise.then(
                val => { clearTimeout(timer); resolve(val); },
                err => { clearTimeout(timer); reject(err); }
            );
        });
    }

    /** Check if URL is a known CORS-friendly API (fetch works without native plugin) */
    _isCorsApi(url) {
        return url.includes('api.jikan.moe') ||
               url.includes('api.mangadex.org') ||
               url.includes('uploads.mangadex.org') ||
               url.includes('integrate.api.nvidia.com') ||
               url.includes('api.duckduckgo.com') ||
               url.includes('jsonblob.com');
    }
}

export const http = new HttpClient();
