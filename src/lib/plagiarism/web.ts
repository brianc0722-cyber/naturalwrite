import type { SourceHit } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const SKIP_HOST = /(duckduckgo|google\.|bing\.|yahoo\.|baidu\.|yandex\.|facebook\.|twitter\.|x\.com|instagram\.|tiktok\.|linkedin\.|youtube\.|reddit\.com\/r\/)/i;

export async function searchDuckDuckGo(query: string, limit = 8): Promise<SourceHit[]> {
  const quoted = `"${query.replace(/"/g, "")}"`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(quoted)}`;
  const html = await getText(url, 10000);
  if (!html) return [];
  return parseDuckDuckGo(html, limit);
}

export async function searchBrave(query: string, apiKey: string, limit = 8): Promise<SourceHit[]> {
  const quoted = `"${query.replace(/"/g, "")}"`;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(quoted)}&count=${limit}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
        "User-Agent": UA,
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    return (data.web?.results ?? [])
      .filter((r) => r.url && r.title && !SKIP_HOST.test(r.url))
      .map((r) => ({
        title: r.title as string,
        url: r.url as string,
        snippet: (r.description || "").slice(0, 900),
        provider: "Brave",
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function searchWeb(query: string, keys?: { serpKey?: string; braveKey?: string }): Promise<SourceHit[]> {
  const tasks: Promise<SourceHit[]>[] = [searchDuckDuckGo(query)];
  if (keys?.braveKey) tasks.push(searchBrave(query, keys.braveKey));
  const settled = await Promise.allSettled(tasks);
  const hits: SourceHit[] = [];
  const seen = new Set<string>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const h of s.value) {
      const key = h.url.replace(/\/$/, "").toLowerCase();
      if (seen.has(key) || SKIP_HOST.test(h.url)) continue;
      seen.add(key);
      hits.push(h);
    }
  }
  return hits;
}

export async function fetchPageText(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url) || SKIP_HOST.test(url)) return "";
  const direct = await fetchAndExtract(url);
  if (direct.length > 500) return direct;
  const viaJina = await fetchAndExtract(`https://r.jina.ai/${url}`);
  return viaJina.length > direct.length ? viaJina : direct;
}

async function fetchAndExtract(url: string): Promise<string> {
  const raw = await getText(url, 8000, 250_000);
  if (!raw) return "";
  return htmlToText(raw).slice(0, 20_000);
}

function parseDuckDuckGo(html: string, limit: number): SourceHit[] {
  const hits: SourceHit[] = [];
  const seen = new Set<string>();

  const resultRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = resultRe.exec(html)) && hits.length < limit) {
    const href = decodeDuckHref(m[1]);
    const title = stripTags(m[2]);
    if (!href || !title || SKIP_HOST.test(href) || seen.has(href)) continue;
    seen.add(href);
    hits.push({ title, url: href, snippet: "", provider: "Web" });
  }

  if (!hits.length) {
    const liteRe = /<a[^>]*rel="nofollow"[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = liteRe.exec(html)) && hits.length < limit) {
      const href = m[1];
      const title = stripTags(m[2]);
      if (!href || !title || SKIP_HOST.test(href) || seen.has(href)) continue;
      seen.add(href);
      hits.push({ title, url: href, snippet: "", provider: "Web" });
    }
  }

  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];
  snippets.forEach((s, i) => {
    if (hits[i] && !hits[i].snippet) hits[i].snippet = stripTags(s[1]).slice(0, 400);
  });

  return hits;
}

function decodeDuckHref(href: string): string {
  try {
    const abs = href.startsWith("//") ? `https:${href}` : href;
    const u = new URL(abs, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (u.hostname.includes("duckduckgo")) return "";
    return u.toString();
  } catch {
    return "";
  }
}

async function getText(url: string, timeoutMs: number, maxBytes = 400_000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function htmlToText(html: string): string {
  return stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
  );
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
