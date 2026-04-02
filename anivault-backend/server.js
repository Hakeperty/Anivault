import express from "express";
import { TTLCache } from "./cache.js";
import * as scraper from "./scraper.js";

const app = express();
const PORT = process.env.PORT || 6969;
const cache = new TTLCache();
const CATEGORY_WHITELIST = new Set([
    "top-airing",
    "most-popular",
    "most-favorite",
    "completed",
    "recently-updated",
    "recently-added",
    "top-upcoming",
]);

// Cache TTLs (ms)
const TTL = {
    HOME: 10 * 60 * 1000,
    SEARCH: 5 * 60 * 1000,
    SUGGEST: 3 * 60 * 1000,
    INFO: 30 * 60 * 1000,
    EPISODES: 15 * 60 * 1000,
    SCHEDULE: 60 * 60 * 1000,
    GENRE: 10 * 60 * 1000,
    CATEGORY: 10 * 60 * 1000,
};

// CORS open for Capacitor webview
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    next();
});

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        console.log(`[${req.method}] ${req.originalUrl} → ${res.statusCode} in ${Date.now() - start}ms`);
    });
    next();
});

// Helper: cached route handler
function cachedRoute(keyFn, fetchFn, ttl) {
    return async (req, res) => {
        try {
            const key = keyFn(req);
            const hit = cache.get(key);
            if (hit) return res.json({ success: true, data: hit, cached: true });

            const data = await fetchFn(req);
            cache.set(key, data, ttl);
            res.json({ success: true, data, cached: false });
        } catch (err) {
            const status = Number(err?.status) || 500;
            res.status(status).json({ success: false, error: err.message || "Internal server error" });
        }
    };
}

// Routes

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/home", cachedRoute(
    () => "home",
    () => scraper.getHome(),
    TTL.HOME
));

app.get("/api/search", cachedRoute(
    (req) => `search:${req.query.q}:${req.query.page || 1}:${req.query.genres || ""}:${req.query.type || ""}:${req.query.sort || ""}:${req.query.season || ""}:${req.query.language || ""}:${req.query.status || ""}:${req.query.rated || ""}`,
    (req) => {
        const { q, page, genres, type, sort, season, language, status, rated } = req.query;
        if (!q) {
            const error = new Error("Missing query parameter 'q'");
            error.status = 400;
            throw error;
        }
        const filters = {};
        if (genres) filters.genres = genres;
        if (type) filters.type = type;
        if (sort) filters.sort = sort;
        if (season) filters.season = season;
        if (language) filters.language = language;
        if (status) filters.status = status;
        if (rated) filters.rated = rated;
        return scraper.searchAnime(q, parseInt(page) || 1, filters);
    },
    TTL.SEARCH
));

app.get("/api/search/suggest", cachedRoute(
    (req) => `suggest:${req.query.q}`,
    (req) => {
        if (!req.query.q) {
            const error = new Error("Missing query parameter 'q'");
            error.status = 400;
            throw error;
        }
        return scraper.getSearchSuggestions(req.query.q);
    },
    TTL.SUGGEST
));

app.get("/api/anime/:animeId/episodes", cachedRoute(
    (req) => `episodes:${req.params.animeId}`,
    (req) => scraper.getEpisodes(req.params.animeId),
    TTL.EPISODES
));

app.get("/api/anime/:animeId", cachedRoute(
    (req) => `info:${req.params.animeId}`,
    (req) => scraper.getAnimeInfo(req.params.animeId),
    TTL.INFO
));

app.get("/api/schedule", cachedRoute(
    (req) => `schedule:${req.query.date || "today"}`,
    (req) => {
        if (req.query.date && !/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
            const error = new Error("Invalid date format. Use YYYY-MM-DD");
            error.status = 400;
            throw error;
        }
        return scraper.getSchedule(req.query.date);
    },
    TTL.SCHEDULE
));

app.get("/api/genre/:genre", cachedRoute(
    (req) => `genre:${req.params.genre}:${req.query.page || 1}`,
    (req) => {
        if (!req.params.genre) {
            const error = new Error("Missing genre");
            error.status = 400;
            throw error;
        }
        return scraper.getGenreAnimes(req.params.genre, parseInt(req.query.page) || 1);
    },
    TTL.GENRE
));

app.get("/api/producer/:producer", cachedRoute(
    (req) => `producer:${req.params.producer}:${req.query.page || 1}`,
    (req) => scraper.getProducerAnimes(req.params.producer, parseInt(req.query.page) || 1),
    TTL.GENRE
));

app.get("/api/category/:category", cachedRoute(
    (req) => `category:${req.params.category}:${req.query.page || 1}`,
    (req) => {
        if (!CATEGORY_WHITELIST.has(req.params.category)) {
            const error = new Error(`Invalid category. Allowed: ${Array.from(CATEGORY_WHITELIST).join(", ")}`);
            error.status = 400;
            throw error;
        }
        return scraper.getCategory(req.params.category, parseInt(req.query.page) || 1);
    },
    TTL.CATEGORY
));

app.listen(PORT, () => {
    console.log(`\n🔥 AniVault Backend running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
});
