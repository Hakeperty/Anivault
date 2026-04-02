export class TTLCache {
    constructor(defaultTTLms = 5 * 60 * 1000) {
        this._store = new Map();
        this._defaultTTL = defaultTTLms;
    }

    set(key, value, ttlMs) {
        const expiry = Date.now() + (ttlMs || this._defaultTTL);
        this._store.set(key, { value, expiry });
    }

    get(key) {
        const entry = this._store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiry) {
            this._store.delete(key);
            return null;
        }
        return entry.value;
    }

    delete(key) {
        this._store.delete(key);
    }
}
