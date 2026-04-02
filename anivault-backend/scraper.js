import { HiAnime } from "aniwatch";

const hianime = new HiAnime.Scraper();

async function callMethod(methodNames, ...args) {
    for (const methodName of methodNames) {
        const method = hianime?.[methodName];
        if (typeof method === "function") {
            return method.call(hianime, ...args);
        }
    }
    throw new Error(`Unsupported aniwatch method: ${methodNames.join(" or ")}`);
}

export async function getHome() {
    try {
        return await callMethod(["getHomePage"]);
    } catch (err) {
        console.error("[scraper] getHome error:", err.message);
        throw err;
    }
}

export async function searchAnime(query, page = 1, filters = {}) {
    try {
        return await callMethod(["search"], query, page, filters);
    } catch (err) {
        console.error("[scraper] searchAnime error:", err.message);
        throw err;
    }
}

export async function getSearchSuggestions(query) {
    try {
        return await callMethod(["searchSuggestions"], query);
    } catch (err) {
        console.error("[scraper] getSearchSuggestions error:", err.message);
        throw err;
    }
}

export async function getAnimeInfo(animeId) {
    try {
        return await callMethod(["getInfo"], animeId);
    } catch (err) {
        console.error("[scraper] getAnimeInfo error:", err.message);
        throw err;
    }
}

export async function getEpisodes(animeId) {
    try {
        return await callMethod(["getEpisodes"], animeId);
    } catch (err) {
        console.error("[scraper] getEpisodes error:", err.message);
        throw err;
    }
}

export async function getSchedule(date) {
    try {
        const resolvedDate = date || new Date().toISOString().slice(0, 10);
        return await callMethod(["getAnimeSchedule", "getEstimatedSchedule"], resolvedDate);
    } catch (err) {
        console.error("[scraper] getSchedule error:", err.message);
        throw err;
    }
}

export async function getGenreAnimes(genre, page = 1) {
    try {
        return await callMethod(["getGenreAnimes", "getGenreAnime"], genre, page);
    } catch (err) {
        console.error("[scraper] getGenreAnimes error:", err.message);
        throw err;
    }
}

export async function getProducerAnimes(producer, page = 1) {
    try {
        return await callMethod(["getProducerAnimes"], producer, page);
    } catch (err) {
        console.error("[scraper] getProducerAnimes error:", err.message);
        throw err;
    }
}

export async function getCategory(category, page = 1) {
    try {
        return await callMethod(["getCategoryAnimes", "getCategoryAnime"], category, page);
    } catch (err) {
        console.error("[scraper] getCategory error:", err.message);
        throw err;
    }
}
