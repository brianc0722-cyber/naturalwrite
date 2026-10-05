import type { SourceHit } from "./types";

const UA =
  "NaturalWritePlagiarismChecker/1.0 (originality-scanner; mailto:research@naturalwrite.local)";

function mailto(): string {
  return process.env.OPENALEX_MAILTO || process.env.CONTACT_EMAIL || "research@naturalwrite.local";
}

async function getJson(
  url: string,
  timeoutMs = 8000,
  extraHeaders?: Record<string, string>,
): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json", ...extraHeaders },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function getText(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/atom+xml, application/xml, text/xml" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

type WikiSearch = {
  query?: { search?: { title: string; snippet: string; pageid: number }[] };
};

type WikiExtract = {
  query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string }> };
};

export async function searchWikipedia(query: string, limit = 3): Promise<SourceHit[]> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1" +
    `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
  const data = (await getJson(url)) as WikiSearch | null;
  const rows = data?.query?.search ?? [];
  if (!rows.length) return [];

  const titles = rows.map((r) => r.title).join("|");
  const extractUrl =
    "https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1" +
    `&inprop=url&format=json&utf8=1&titles=${encodeURIComponent(titles)}`;
  const extracts = (await getJson(extractUrl)) as WikiExtract | null;
  const pages = extracts?.query?.pages ?? {};
  const byTitle = new Map<string, { extract: string; url: string }>();
  for (const p of Object.values(pages)) {
    byTitle.set(p.title, {
      extract: p.extract || "",
      url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
    });
  }

  return rows.map((r) => {
    const extra = byTitle.get(r.title);
    const snippet = stripTags(r.snippet);
    return {
      title: r.title,
      url: extra?.url || `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
      snippet: (extra?.extract || snippet).slice(0, 900),
      provider: "Wikipedia",
    };
  });
}

type Crossref = {
  message?: {
    items?: {
      title?: string[];
      URL?: string;
      abstract?: string;
    }[];
  };
};

export async function searchCrossref(query: string, limit = 2): Promise<SourceHit[]> {
  const url = `https://api.crossref.org/works?rows=${limit}&query=${encodeURIComponent(query)}`;
  const data = (await getJson(url, 9000)) as Crossref | null;
  const items = data?.message?.items ?? [];
  return items
    .map((it) => {
      const title = (it.title && it.title[0]) || "Untitled work";
      const abstract = it.abstract ? stripTags(it.abstract) : "";
      return {
        title,
        url: it.URL || `https://search.crossref.org/?q=${encodeURIComponent(title)}`,
        snippet: (abstract || title).slice(0, 900),
        provider: "Crossref",
      };
    })
    .filter((h) => h.title.length > 3);
}

type S2 = {
  data?: { title: string; abstract?: string | null; url?: string | null }[];
};

export async function searchSemanticScholar(query: string, limit = 2): Promise<SourceHit[]> {
  const url =
    "https://api.semanticscholar.org/graph/v1/paper/search" +
    `?limit=${limit}&query=${encodeURIComponent(query)}&fields=title,abstract,url,year`;
  const data = (await getJson(url, 9000)) as S2 | null;
  return (data?.data ?? [])
    .filter((p) => p.title)
    .map((p) => ({
      title: p.title,
      url: p.url || `https://www.semanticscholar.org/search?q=${encodeURIComponent(p.title)}`,
      snippet: (p.abstract || p.title).slice(0, 900),
      provider: "Semantic Scholar",
    }));
}

type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  display_name?: string;
  title?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string | null } | null;
};

type OpenAlex = { results?: OpenAlexWork[] };

export async function searchOpenAlex(query: string, limit = 3): Promise<SourceHit[]> {
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}` +
    `&per_page=${limit}&select=id,doi,display_name,title,abstract_inverted_index,primary_location` +
    `&mailto=${encodeURIComponent(mailto())}`;
  const data = (await getJson(url, 10000)) as OpenAlex | null;
  return (data?.results ?? [])
    .map((w) => {
      const title = w.display_name || w.title || "Untitled work";
      const abstract = reconstructInvertedAbstract(w.abstract_inverted_index);
      const doi = w.doi ? w.doi.replace(/^https?:\/\/doi.org\//, "") : "";
      const urlOut =
        w.primary_location?.landing_page_url ||
        (doi ? `https://doi.org/${doi}` : "") ||
        (w.id ? w.id.replace("https://openalex.org/", "https://openalex.org/") : "") ||
        `https://openalex.org/works?search=${encodeURIComponent(title)}`;
      return {
        title,
        url: urlOut,
        snippet: (abstract || title).slice(0, 900),
        provider: "OpenAlex",
      };
    })
    .filter((h) => h.title.length > 3);
}

type EuropePmcResult = {
  title?: string;
  abstractText?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  source?: string;
  id?: string;
};

type EuropePmc = { resultList?: { result?: EuropePmcResult[] } };

export async function searchEuropePmc(query: string, limit = 3): Promise<SourceHit[]> {
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search" +
    `?query=${encodeURIComponent(query)}&format=json&pageSize=${limit}&resultType=core`;
  const data = (await getJson(url, 10000)) as EuropePmc | null;
  return (data?.resultList?.result ?? [])
    .map((r) => {
      const title = r.title || "Untitled work";
      const snippet = r.abstractText || title;
      let link = "";
      if (r.doi) link = `https://doi.org/${r.doi}`;
      else if (r.pmcid) link = `https://europepmc.org/articles/${r.pmcid}`;
      else if (r.pmid) link = `https://europepmc.org/article/MED/${r.pmid}`;
      else if (r.id && r.source) link = `https://europepmc.org/article/${r.source}/${r.id}`;
      else link = `https://europepmc.org/search?query=${encodeURIComponent(title)}`;
      return {
        title: stripTags(title),
        url: link,
        snippet: stripTags(snippet).slice(0, 900),
        provider: "Europe PMC",
      };
    })
    .filter((h) => h.title.length > 3);
}

export async function searchArxiv(query: string, limit = 3): Promise<SourceHit[]> {
  const q = query.replace(/[^\w\s-]/g, " ").trim().split(/\s+/).slice(0, 10).join(" ");
  const url =
    `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}` +
    `&start=0&max_results=${limit}`;
  const xml = await getText(url, 10000);
  if (!xml) return [];
  return parseArxivAtom(xml);
}

type SerpOrganic = { title?: string; link?: string; snippet?: string };
type Serp = { organic_results?: SerpOrganic[] };

export async function searchSerpApi(query: string, apiKey: string, limit = 5): Promise<SourceHit[]> {
  const url =
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent('"' + query + '"')}&api_key=${encodeURIComponent(apiKey)}&num=${limit}`;
  const data = (await getJson(url, 10000)) as Serp | null;
  return (data?.organic_results ?? [])
    .filter((r) => r.link && r.title)
    .map((r) => ({
      title: r.title as string,
      url: r.link as string,
      snippet: (r.snippet || "").slice(0, 900),
      provider: "Google",
    }));
}

export async function searchWikiSite(
  origin: string,
  provider: string,
  query: string,
  limit = 3,
): Promise<SourceHit[]> {
  const url =
    `${origin}/w/api.php?action=query&list=search&format=json&utf8=1` +
    `&srlimit=${limit}&srsearch=${encodeURIComponent('"' + query.replace(/"/g, "") + '"')}`;
  const data = (await getJson(url)) as WikiSearch | null;
  const rows = data?.query?.search ?? [];
  if (!rows.length) {
    const loose =
      `${origin}/w/api.php?action=query&list=search&format=json&utf8=1` +
      `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
    const data2 = (await getJson(loose)) as WikiSearch | null;
    return wikiRowsToHits(origin, provider, data2?.query?.search ?? []);
  }
  return wikiRowsToHits(origin, provider, rows);
}

function wikiRowsToHits(
  origin: string,
  provider: string,
  rows: { title: string; snippet: string }[],
): SourceHit[] {
  return rows.map((r) => ({
    title: r.title,
    url: `${origin}/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: stripTags(r.snippet).slice(0, 900),
    provider,
  }));
}

export async function searchWikisource(query: string): Promise<SourceHit[]> {
  return searchWikiSite("https://en.wikisource.org", "Wikisource", query);
}

export async function searchWikinews(query: string): Promise<SourceHit[]> {
  return searchWikiSite("https://en.wikinews.org", "Wikinews", query);
}

type ArchiveDoc = { identifier?: string; title?: string; description?: string };
type ArchiveSearch = { response?: { docs?: ArchiveDoc[] } };

export async function searchInternetArchive(query: string, limit = 3): Promise<SourceHit[]> {
  const q = `(${query}) AND mediatype:texts`;
  const url =
    "https://archive.org/advancedsearch.php?" +
    `q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=description` +
    `&rows=${limit}&page=1&output=json`;
  const data = (await getJson(url, 10000)) as ArchiveSearch | null;
  return (data?.response?.docs ?? [])
    .filter((d) => d.identifier && d.title)
    .map((d) => ({
      title: String(d.title),
      url: `https://archive.org/details/${d.identifier}`,
      snippet: String(d.description || d.title).slice(0, 900),
      provider: "Internet Archive",
    }));
}

type CoreWork = {
  id?: number | string;
  title?: string;
  abstract?: string;
  fullText?: string;
  doi?: string | null;
  downloadUrl?: string | null;
};

type CoreSearch = { results?: CoreWork[] };

export async function searchCore(query: string, limit = 3): Promise<SourceHit[]> {
  const key = process.env.CORE_API_KEY;
  const url =
    `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=${limit}`;
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  const data = (await getJson(url, 10000, headers)) as CoreSearch | null;
  return (data?.results ?? [])
    .filter((w) => w.title)
    .map((w) => {
      const snippet = (w.fullText || w.abstract || w.title || "").slice(0, 900);
      const link =
        (w.doi ? `https://doi.org/${String(w.doi).replace(/^https?:\/\/doi.org\//, "")}` : "") ||
        (w.downloadUrl || "") ||
        (w.id != null ? `https://core.ac.uk/works/${w.id}` : `https://core.ac.uk/search?q=${encodeURIComponent(w.title!)}`);
      return {
        title: w.title as string,
        url: link,
        snippet,
        provider: "CORE",
      };
    });
}

export async function searchAllSources(query: string, serpKey?: string): Promise<SourceHit[]> {
  const tasks: Promise<SourceHit[]>[] = [
    searchWikipedia(query),
    searchWikisource(query),
    searchWikinews(query),
    searchInternetArchive(query),
    searchCore(query),
    searchOpenAlex(query),
    searchEuropePmc(query),
    searchArxiv(query),
    searchCrossref(query),
    searchSemanticScholar(query),
  ];
  if (serpKey) tasks.push(searchSerpApi(query, serpKey));

  const settled = await Promise.allSettled(tasks);
  const hits: SourceHit[] = [];
  const seen = new Set<string>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const h of s.value) {
      const key = normalizeUrl(h.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }
  }
  return hits;
}

function reconstructInvertedAbstract(index?: Record<string, number[]> | null): string {
  if (!index) return "";
  const slots: { word: string; pos: number }[] = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) slots.push({ word, pos });
  }
  slots.sort((a, b) => a.pos - b.pos);
  return slots.map((s) => s.word).join(" ");
}

function parseArxivAtom(xml: string): SourceHit[] {
  const entries = xml.split(/<entry>/).slice(1);
  const hits: SourceHit[] = [];
  for (const raw of entries) {
    const title = stripTags(inner(raw, "title")).replace(/\s+/g, " ").trim();
    const summary = stripTags(inner(raw, "summary")).replace(/\s+/g, " ").trim();
    const id = stripTags(inner(raw, "id")).trim();
    if (!title) continue;
    const abs = id.includes("arxiv.org")
      ? id.replace("http://", "https://")
      : `https://arxiv.org/search/?query=${encodeURIComponent(title)}`;
    hits.push({
      title,
      url: abs,
      snippet: (summary || title).slice(0, 900),
      provider: "arXiv",
    });
  }
  return hits;
}

function inner(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "").toLowerCase().replace(/^http:/, "https:");
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
