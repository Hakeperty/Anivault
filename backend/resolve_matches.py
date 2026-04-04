"""
AniVault Backend – Resolve wrong-match reports.
Runs as a GitHub Action (cron every 30 min) or manually.

1. Reads reports from jsonblob (REPORTS_BLOB)
2. For each unresolved report, uses NVIDIA GLM5 + Jikan + MangaDex + DuckDuckGo to find best match
3. Updates community match DB (COMMUNITY_BLOB)
4. Clears resolved reports
"""

import os, sys, json, time, re, urllib.parse, requests

# ── Config ────────────────────────────────────────────────────────────────────
REPORTS_BLOB   = "019d5a40-7db9-7b20-a5f6-7df117b5b5a1"
COMMUNITY_BLOB = "019d5a38-435f-7b8f-a637-119b4b79ac6e"
BLOB_BASE      = "https://jsonblob.com/api/jsonBlob"
NVIDIA_API     = "https://integrate.api.nvidia.com/v1/chat/completions"
NVIDIA_MODEL   = "z-ai/glm5"

API_KEY = os.environ.get("NVIDIA_API_KEY", "")
if not API_KEY:
    print("ERROR: NVIDIA_API_KEY not set"); sys.exit(1)

HEADERS_BLOB = {"Content-Type": "application/json", "Accept": "application/json"}
HEADERS_AI   = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch_blob(blob_id):
    r = requests.get(f"{BLOB_BASE}/{blob_id}", headers=HEADERS_BLOB, timeout=15)
    r.raise_for_status()
    return r.json()

def put_blob(blob_id, data):
    r = requests.put(f"{BLOB_BASE}/{blob_id}", json=data, headers=HEADERS_BLOB, timeout=15)
    r.raise_for_status()
    return r.json()

def search_jikan(title, manga=True):
    t = "manga" if manga else "anime"
    url = f"https://api.jikan.moe/v4/{t}?q={urllib.parse.quote(title)}&limit=8"
    try:
        r = requests.get(url, timeout=10); r.raise_for_status()
        return r.json().get("data", [])
    except Exception as e:
        print(f"  Jikan error: {e}"); return []

def search_mangadex(title):
    url = "https://api.mangadex.org/manga"
    params = {"title": title, "limit": 8, "includes[]": "cover_art"}
    try:
        r = requests.get(url, params=params, timeout=10); r.raise_for_status()
        return r.json().get("data", [])
    except Exception as e:
        print(f"  MangaDex error: {e}"); return []

def search_ddg(query):
    try:
        url = f"https://api.duckduckgo.com/?q={urllib.parse.quote(query)}&format=json&no_redirect=1"
        r = requests.get(url, timeout=5); r.raise_for_status()
        data = r.json()
        results = []
        if data.get("Abstract"):
            results.append(data["Abstract"])
        for topic in data.get("RelatedTopics", [])[:3]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append(topic["Text"])
        return " | ".join(results)[:600]
    except:
        return ""

def ask_nvidia(title, candidates, context=""):
    if not candidates:
        return None

    cand_list = ""
    for i, c in enumerate(candidates, 1):
        name = c.get("name") or c.get("title") or "?"
        eng  = c.get("name_english") or c.get("title_english") or ""
        synonyms = ", ".join((c.get("title_synonyms") or [])[:3])
        info = name
        if eng: info += f" (English: {eng})"
        if synonyms: info += f" [also: {synonyms}]"
        cand_list += f"{i}. {info}\n"

    ctx_note = f"\nWeb context: {context}" if context else ""

    prompt = f"""I need to match the anime/manga title "{title}" to the correct entry.
Candidates:
{cand_list}{ctx_note}

Pick the BEST match. Reply with ONLY valid JSON:
{{"pick": <number 1-{len(candidates)} or 0 if none>, "confidence": <0-100>, "reason": "brief reason"}}"""

    body = {
        "model": NVIDIA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1, "max_tokens": 256, "stream": False,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": True, "clear_thinking": False}}
    }

    try:
        r = requests.post(NVIDIA_API, json=body, headers=HEADERS_AI, timeout=30)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
        # Strip thinking tags if present
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
        match = re.search(r'\{[^}]+\}', text)
        if match:
            return json.loads(match.group())
    except Exception as e:
        print(f"  NVIDIA error: {e}")
    return None

# ── Main resolver ─────────────────────────────────────────────────────────────

def resolve_report(report):
    title = report.get("title", "")
    title_en = report.get("titleEnglish", "")
    rtype = report.get("type", "manga")

    print(f"\nResolving: {title} ({rtype})")

    is_manga = rtype in ("manga", "novel", "manhwa", "manhua", "one_shot")

    # Search multiple sources
    query = title_en or title
    jikan_results = search_jikan(query, manga=is_manga)
    time.sleep(0.4)  # Jikan rate limit

    if not jikan_results and title_en and title_en != title:
        jikan_results = search_jikan(title, manga=is_manga)
        time.sleep(0.4)

    mdex_results = []
    if is_manga:
        mdex_results = search_mangadex(query)

    # Build unified candidates
    candidates = []
    seen = set()

    for j in jikan_results:
        key = str(j.get("mal_id", ""))
        if key not in seen:
            seen.add(key)
            candidates.append({
                "name": j.get("title", ""),
                "name_english": j.get("title_english", ""),
                "title_synonyms": j.get("title_synonyms", []),
                "source": "jikan",
                "mal_id": j.get("mal_id"),
                "url": j.get("url", "")
            })

    for m in mdex_results:
        attrs = m.get("attributes", {})
        t = attrs.get("title", {})
        name = t.get("en") or t.get("ja-ro") or t.get("ja") or ""
        alt_titles = attrs.get("altTitles", [])
        eng = ""
        for a in alt_titles:
            if "en" in a: eng = a["en"]; break
        key = m.get("id", "")
        if key not in seen:
            seen.add(key)
            candidates.append({
                "name": name,
                "name_english": eng,
                "title_synonyms": [a.get("en","") or list(a.values())[0] for a in alt_titles[:3] if a],
                "source": "mangadex",
                "mdex_id": key
            })

    if not candidates:
        print(f"  No candidates found for '{title}'")
        return None

    # DuckDuckGo context
    ddg_ctx = search_ddg(f"{query} anime manga myanimelist")

    # Ask AI
    result = ask_nvidia(title, candidates, ddg_ctx)
    if not result:
        print(f"  AI returned no result")
        return None

    pick = result.get("pick", 0)
    confidence = result.get("confidence", 0)
    reason = result.get("reason", "")

    if pick < 1 or pick > len(candidates) or confidence < 50:
        print(f"  Low confidence or no match: pick={pick}, conf={confidence}")
        return None

    chosen = candidates[pick - 1]
    print(f"  Matched: {chosen['name']} (conf={confidence}%, reason={reason})")

    # Build match entry for community DB
    match_key = re.sub(r'\s+', ' ', title.lower()).strip()
    entry = {
        "matchedTitle": chosen["name"],
        "matchedTitleEnglish": chosen.get("name_english", ""),
        "confidence": confidence,
        "source": chosen.get("source", ""),
        "reason": reason,
        "resolvedAt": int(time.time() * 1000)
    }

    if chosen.get("mal_id"):
        entry["malId"] = chosen["mal_id"]
    if chosen.get("mdex_id"):
        entry["mdexId"] = chosen["mdex_id"]

    return (match_key, entry)


def main():
    print("=== AniVault Match Resolver ===")
    print(f"Time: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")

    # Fetch reports
    try:
        reports_data = fetch_blob(REPORTS_BLOB)
    except Exception as e:
        print(f"Failed to fetch reports: {e}"); return

    reports = reports_data.get("reports", [])
    if not reports:
        print("No reports to process."); return

    print(f"Found {len(reports)} report(s)")

    # Fetch community DB
    try:
        community = fetch_blob(COMMUNITY_BLOB)
    except:
        community = {"version": 1, "matches": {}}

    matches = community.get("matches", {})
    resolved_indices = []

    for i, report in enumerate(reports):
        result = resolve_report(report)
        if result:
            key, entry = result
            matches[key] = entry
            resolved_indices.append(i)
        time.sleep(1)  # Rate limiting between reports

    if resolved_indices:
        # Update community DB
        community["matches"] = matches
        community["version"] = community.get("version", 1) + 1
        community["lastUpdated"] = int(time.time() * 1000)
        put_blob(COMMUNITY_BLOB, community)
        print(f"\nUpdated community DB with {len(resolved_indices)} new match(es)")

        # Remove resolved reports
        remaining = [r for i, r in enumerate(reports) if i not in resolved_indices]
        reports_data["reports"] = remaining
        put_blob(REPORTS_BLOB, reports_data)
        print(f"Cleared {len(resolved_indices)} resolved report(s), {len(remaining)} remaining")
    else:
        print("\nNo reports resolved this run.")

    print("Done.")


if __name__ == "__main__":
    main()
