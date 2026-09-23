import type { ToolStep } from './types';

/*
 * Where an answer came from.
 *
 * The bot already searches the web, reads Wikipedia and opens pages, but the
 * links only exist inside the collapsed tool trace: to see whether a claim
 * rests on a real page you had to expand the activity block and read raw
 * JSON. That is the wrong price for a basic question, so the links are lifted
 * out of the trace and shown under the reply itself.
 *
 * The shapes are not fixed. `web_search` answers {results: [{title, url}]},
 * `facts` answers a bare {title, url}, MCP wraps either in a content list
 * whose text is JSON again, and OpenClaw's own web tools answer whatever
 * their provider returns. Rather than maintain a table of shapes per tool,
 * the result is walked and every http(s) URL is taken, with the nearest title
 * travelling alongside it.
 */

export interface Source {
  url: string;
  /** Page title when the tool reported one; empty string when it did not. */
  title: string;
  /** Hostname without `www.` — this is what the strip actually shows. */
  host: string;
  /** The tool that produced the link, so a source can be traced back. */
  tool: string;
}

/** Tools whose links are pictures already rendered in the reply, not reading. */
const NOT_SOURCES = new Set(['image_search', 'play_music', 'play_video', 'listen_to_video']);

const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;

/*
 * Paid placements that search engines mix into their results. They are not
 * where the answer came from, and listing a Bing click-tracker under a reply
 * would be worse than listing nothing: it dresses an advert up as evidence.
 */
const AD_LINK = [
  /^duckduckgo\.com\/y\.js/i,
  /^duckduckgo\.com\/l\//i,
  /\/aclick\?/i,
  /\/aclk\?/i,
  /^googleadservices\.com\//i,
  /^www\.googleadservices\.com\//i,
  /^ad\./i,
  /^ads\./i,
];

/** Deeper than this a result is no longer a search payload but a dump. */
const MAX_DEPTH = 8;
const MAX_SOURCES = 12;

/** `tools__web_search` and `web_search` are the same tool to a reader. */
export function bareToolName(label: string): string {
  const cut = label.lastIndexOf('__');
  return cut === -1 ? label : label.slice(cut + 2);
}

/**
 * A usable link, or null.
 *
 * Search results arrive HTML-escaped often enough that `&amp;` in a query
 * string is normal, and a link that keeps it points somewhere else.
 */
function clean(raw: string): URL | null {
  try {
    const url = new URL(raw.replace(/&amp;/g, '&'));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    if (IMAGE_PATH.test(url.pathname)) return null;
    const tail = `${url.hostname}${url.pathname}${url.search}`;
    if (AD_LINK.some((pattern) => pattern.test(tail))) return null;
    return url;
  } catch {
    return null;
  }
}

/** Same page twice is one source: the fragment and a trailing slash are noise. */
function canonical(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = '';
  const text = copy.toString();
  return text.endsWith('/') ? text.slice(0, -1) : text;
}

/** The first string field that reads like a human title, not a URL or a blob. */
function titleOf(record: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'heading', 'headline']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() && !value.startsWith('http')) {
      return value.trim().slice(0, 140);
    }
  }
  return '';
}

function take(raw: string, title: string, tool: string, out: Source[]): void {
  const url = clean(raw);
  if (!url) return;
  out.push({
    url: url.toString(),
    title,
    host: url.hostname.replace(/^www\./, ''),
    tool,
  });
}

function walk(value: unknown, tool: string, depth: number, out: Source[]): void {
  if (depth > MAX_DEPTH || out.length >= MAX_SOURCES) return;

  if (typeof value === 'string') {
    const text = value.trim();
    // MCP hands a tool's answer back as text, and that text is usually the
    // tool's JSON. Parsed, it gives titles; left as a string it gives only
    // whatever the URL regex can scrape out of it.
    if ((text.startsWith('{') || text.startsWith('[')) && text.length < 400_000) {
      try {
        walk(JSON.parse(text), tool, depth + 1, out);
        return;
      } catch {
        // Not JSON after all — fall through and read it as prose.
      }
    }
    // A bare link in prose (a snippet, a "read more" line) still counts.
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
      take(match[0].replace(/[.,;:]+$/, ''), '', tool, out);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) walk(item, tool, depth + 1, out);
    return;
  }

  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;

  // A record that carries its own link keeps its own title; nested records are
  // walked separately so a list of results does not inherit the list's title.
  for (const key of ['url', 'link', 'href', 'source', 'page']) {
    const link = record[key];
    if (typeof link !== 'string' || !/^https?:\/\//.test(link)) continue;
    take(link, titleOf(record), tool, out);
    break;
  }

  for (const [key, item] of Object.entries(record)) {
    if (['url', 'link', 'href'].includes(key)) continue;
    walk(item, tool, depth + 1, out);
  }
}

/**
 * Sources of one reply, in the order the bot found them.
 *
 * Only completed calls contribute. A search that failed proves nothing about
 * where the answer came from, and an interrupted one may have been cut off
 * mid-page — showing either would claim evidence the bot never had.
 */
export function collectSources(steps: ToolStep[]): Source[] {
  const found: Source[] = [];
  for (const step of steps) {
    if (step.status !== 'done') continue;
    const tool = bareToolName(step.label);
    if (NOT_SOURCES.has(tool)) continue;
    walk(step.result, tool, 0, found);
  }

  const seen = new Map<string, Source>();
  for (const source of found) {
    const key = canonical(new URL(source.url));
    const old = seen.get(key);
    // The same page can surface twice — once titled, once as a bare link.
    // Keep the titled copy; a hostname alone is the poorer label.
    if (!old) seen.set(key, source);
    else if (!old.title && source.title) seen.set(key, { ...old, title: source.title });
  }
  return [...seen.values()].slice(0, MAX_SOURCES);
}
