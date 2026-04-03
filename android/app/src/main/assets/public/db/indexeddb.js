/**
 * IndexedDB Manager for AniVault
 * Handles all database operations for Library, Progress, and Downloads
 */

export class Database {
    constructor() {
        this.db = null;
        this.dbName = 'AniVaultDB';
        this.version = 1;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Library store
                if (!db.objectStoreNames.contains('library')) {
                    const libStore = db.createObjectStore('library', { keyPath: 'id' });
                    libStore.createIndex('type', 'type', { unique: false });
                    libStore.createIndex('source', 'source', { unique: false });
                    libStore.createIndex('addedAt', 'addedAt', { unique: false });
                }

                // Progress store
                if (!db.objectStoreNames.contains('progress')) {
                    const progStore = db.createObjectStore('progress', { keyPath: 'id' });
                    progStore.createIndex('libraryId', 'libraryId', { unique: false });
                    progStore.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
                }

                // Downloads store
                if (!db.objectStoreNames.contains('downloads')) {
                    const dlStore = db.createObjectStore('downloads', { keyPath: 'id' });
                    dlStore.createIndex('libraryId', 'libraryId', { unique: false });
                    dlStore.createIndex('status', 'status', { unique: false });
                }

                // Settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    // Library Operations
    async addToLibrary(item) {
        const tx = this.db.transaction(['library'], 'readwrite');
        const store = tx.objectStore('library');
        item.addedAt = Date.now();
        store.put(item);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(item);
            tx.onerror = () => reject(tx.error);
        });
    }

    async getLibrary() {
        const tx = this.db.transaction(['library'], 'readonly');
        const store = tx.objectStore('library');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getLibraryItem(id) {
        const tx = this.db.transaction(['library'], 'readonly');
        const store = tx.objectStore('library');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async removeFromLibrary(id) {
        const tx = this.db.transaction(['library', 'progress', 'downloads'], 'readwrite');
        tx.objectStore('library').delete(id);
        const progStore = tx.objectStore('progress');
        const progressItems = await new Promise((resolve, reject) => {
            const request = progStore.index('libraryId').getAll(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        progressItems.forEach(p => progStore.delete(p.id));

        const dlStore = tx.objectStore('downloads');
        const downloadItems = await new Promise((resolve, reject) => {
            const request = dlStore.index('libraryId').getAll(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        downloadItems.forEach(d => dlStore.delete(d.id));

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async searchLibrary(query, type = null) {
        const allItems = await this.getLibrary();
        return allItems.filter(item => {
            const matchesQuery = item.title.toLowerCase().includes(query.toLowerCase());
            const matchesType = !type || item.type === type;
            return matchesQuery && matchesType;
        });
    }

    // Progress Operations
    async saveProgress(libraryId, episodeOrChapterId, number, completed, watchedSeconds = 0) {
        const id = `${libraryId}_${episodeOrChapterId}`;
        const tx = this.db.transaction(['progress'], 'readwrite');
        const store = tx.objectStore('progress');
        
        const progress = {
            id,
            libraryId,
            episodeOrChapterId,
            number,
            completed,
            watchedSeconds,
            lastAccessedAt: Date.now()
        };
        
        store.put(progress);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(progress);
            tx.onerror = () => reject(tx.error);
        });
    }

    async getProgress(libraryId) {
        const tx = this.db.transaction(['progress'], 'readonly');
        const store = tx.objectStore('progress');
        return new Promise((resolve, reject) => {
            const request = store.index('libraryId').getAll(libraryId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getProgressForEpisode(libraryId, episodeOrChapterId) {
        const allProgress = await this.getProgress(libraryId);
        return allProgress.find(p => p.episodeOrChapterId === episodeOrChapterId) || null;
    }

    // Download Operations
    async addDownload(libraryId, episodeOrChapterId, localPath, fileSize) {
        const id = `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tx = this.db.transaction(['downloads'], 'readwrite');
        const store = tx.objectStore('downloads');
        
        const download = {
            id,
            libraryId,
            episodeOrChapterId,
            status: 'queued',
            progress: 0,
            localPath,
            fileSize,
            createdAt: Date.now()
        };
        
        store.put(download);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(download);
            tx.onerror = () => reject(tx.error);
        });
    }

    async getDownloads() {
        const tx = this.db.transaction(['downloads'], 'readonly');
        const store = tx.objectStore('downloads');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async updateDownload(id, updates) {
        const tx = this.db.transaction(['downloads'], 'readwrite');
        const store = tx.objectStore('downloads');
        
        return new Promise((resolve, reject) => {
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const download = getRequest.result;
                const updated = { ...download, ...updates };
                const putRequest = store.put(updated);
                putRequest.onsuccess = () => resolve(updated);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async deleteDownload(id) {
        const tx = this.db.transaction(['downloads'], 'readwrite');
        const store = tx.objectStore('downloads');
        store.delete(id);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Settings Operations
    async setSetting(key, value) {
        const tx = this.db.transaction(['settings'], 'readwrite');
        const store = tx.objectStore('settings');
        store.put({ key, value });
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getSetting(key, defaultValue = null) {
        const tx = this.db.transaction(['settings'], 'readonly');
        const store = tx.objectStore('settings');
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value ?? defaultValue);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllSettings() {
        const tx = this.db.transaction(['settings'], 'readonly');
        const store = tx.objectStore('settings');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const settings = {};
                request.result.forEach(item => {
                    settings[item.key] = item.value;
                });
                resolve(settings);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearAllData() {
        const tx = this.db.transaction(['library', 'progress', 'downloads', 'settings'], 'readwrite');
        tx.objectStore('library').clear();
        tx.objectStore('progress').clear();
        tx.objectStore('downloads').clear();
        tx.objectStore('settings').clear();
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Statistics
    async getLibraryStats() {
        const library = await this.getLibrary();
        const animeCount = library.filter(item => item.type === 'anime').length;
        const mangaCount = library.filter(item => item.type === 'manga').length;
        const totalSize = library.reduce((sum, item) => sum + (item.localSize || 0), 0);
        
        return {
            totalItems: library.length,
            animeCount,
            mangaCount,
            totalSize
        };
    }

    /** Get recently accessed progress records across all library items */
    async getRecentProgress(limit = 20) {
        const tx = this.db.transaction(['progress'], 'readonly');
        const store = tx.objectStore('progress');
        const index = store.index('lastAccessedAt');
        return new Promise((resolve, reject) => {
            const results = [];
            const request = index.openCursor(null, 'prev');
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Export singleton instance
export const db = new Database();
