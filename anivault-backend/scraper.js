import { HiAnime } from "aniwatch";

const hianime = new HiAnime.Scraper();

export async function getHome() {
    try {
        return await hianime.getHomePage();
    } catch (err) {
        console.error("[scraper] getHome error:", err.message);
        throw err;
    }
}

export async function searchAnime(query, page = 1, filters = {}) {
    try {
        return await hianime.search(query, page, filters);
    } catch (err) {
        console.error("[scraper] searchAnime error:", err.message);
        throw err;
    }
}

export async function getSearchSuggestions(query) {
    try {
        return await hianime.searchSuggestions(query);
    } catch (err) {
        console.error("[scraper] getSearchSuggestions error:", err.message);
        throw err;
    }
}

export async function getAnimeInfo(animeId) {
    try {
        return await hianime.getInfo(animeId);
    } catch (err) {
        console.error("[scraper] getAnimeInfo error:", err.message);
        throw err;
    }
}

export async function getEpisodes(animeId) {
    try {
        return await hianime.getEpisodes(animeId);
    } catch (err) {
        console.error("[scraper] getEpisodes error:", err.message);
        throw err;
    }
}

export async function getSchedule(date) {
    try {
        return await hianime.getAnimeSchedule(date);
    } catch (err) {
        console.error("[scraper] getSchedule error:", err.message);
        throw err;
    }
}

export async function getGenreAnimes(genre, page = 1) {
    try {
        return await hianime.getGenreAnime(genre, page);
    } catch (err) {
        console.error("[scraper] getGenreAnimes error:", err.message);
        throw err;
    }
}

export async function getProducerAnimes(producer, page = 1) {
    try {
        return await hianime.getProducerAnimes(producer, page);
    } catch (err) {
        console.error("[scraper] getProducerAnimes error:", err.message);
        throw err;
    }
}

export async function getCategory(category, page = 1) {
    try {
        return await hianime.getCategoryAnime(category, page);
    } catch (err) {
        console.error("[scraper] getCategory error:", err.message);
        throw err;
    }
}
