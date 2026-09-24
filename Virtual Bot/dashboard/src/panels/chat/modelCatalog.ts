import type { Brand } from '../../vendor/lobe-icons';

/*
 * Finding a model among sixty.
 *
 * The OpenClaw catalog grew from a handful to ~60 entries, and the same model
 * is often listed three times through different hosts (DeepSeek V4 Pro via
 * NVIDIA, via opencode-go, via omni). A flat list in catalog order meant
 * scrolling past all of it to reach one name. Three things fix that:
 *
 *   - who made it — a logo and a group per maker, so the eye jumps to
 *     "the OpenAI ones" instead of reading every row;
 *   - search — any words, in any order, across name, id, maker and host;
 *   - recently picked — the two or three models actually in use sit on top.
 *
 * The maker is read from the MODEL part of the id, never from the host:
 * `regolo/gpt-oss-120b` is an OpenAI model served by Regolo, and
 * `nvidia/z-ai/glm-5.2` is Zhipu's, not NVIDIA's. Getting that backwards would
 * put a wrong logo on half the list.
 */

export interface CatalogModel {
  id: string;
  label: string;
  context?: number;
}

export type SortMode = 'maker' | 'name' | 'context';

/*
 * Order matters: the first match wins. Names are matched as whole-ish words
 * so `mimo` does not catch `minimax`, and `hy3` is Tencent's Hunyuan rather
 * than any string containing "hy". Anything unmatched falls under "other" —
 * a neutral mark is honest, a guessed logo is not.
 */
const RULES: [Brand, RegExp][] = [
  ['anthropic', /claude/],
  ['openai', /\bgpt|\bo[1-9](?:-|\b)|\bcodex\b|openai/],
  ['deepseek', /deepseek/],
  ['moonshot', /kimi|moonshot/],
  ['minimax', /minimax/],
  ['xiaomi', /\bmimo\b|xiaomi/],
  ['zhipu', /\bglm|zhipu|\bz-ai\b/],
  ['qwen', /qwen|\bqwq\b/],
  ['meituan', /longcat/],
  ['xai', /\bgrok/],
  ['tencent', /\bhy\d|hunyuan/],
  ['google', /gemini|gemma/],
  ['mistral', /mistral|mixtral|codestral|devstral|magistral/],
  ['meta', /\bllama/],
  ['nvidia', /nemotron/],
];

/** Proper names, the same in every language — data, not interface copy. */
export const BRAND_NAMES: Record<Brand, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  minimax: 'MiniMax',
  xiaomi: 'Xiaomi',
  zhipu: 'Zhipu',
  qwen: 'Qwen',
  meituan: 'Meituan',
  xai: 'xAI',
  tencent: 'Tencent',
  google: 'Google',
  mistral: 'Mistral',
  meta: 'Meta',
  nvidia: 'NVIDIA',
};

/** `omni/opencode-go/kimi-k3` → host `omni/opencode-go`, model `kimi-k3`. */
export function splitId(id: string): { host: string; model: string } {
  const parts = id.split('/');
  if (parts.length < 2) return { host: '', model: id };
  return { host: parts[0], model: parts.slice(1).join('/') };
}

/** Where the model is served from, for telling duplicates apart. */
export function hostOf(id: string): string {
  const parts = id.split('/');
  return parts.length < 2 ? '' : parts.slice(0, -1).join('/');
}

export function brandOf(model: CatalogModel): Brand | null {
  // Everything but the first segment — that one is the OpenClaw provider.
  const haystack = `${splitId(model.id).model} ${model.label}`.toLowerCase();
  for (const [brand, pattern] of RULES) if (pattern.test(haystack)) return brand;
  return null;
}

/*
 * Search index for one model: the text with separators removed, plus the
 * offsets where a word starts in it.
 *
 * Words start after a separator and at every switch between letters and
 * digits, so `qwen3.8-max` has starts at q·3·8·m. Matching only at those
 * starts is what keeps "xai" from finding `minimaxai` — a plain substring
 * search did — while "gpt6" still finds `gpt-6` and "3.8" still finds
 * `qwen3.8`.
 */
function index(text: string): { flat: string; starts: Set<number> } {
  let flat = '';
  const starts = new Set<number>();
  let previous = '';
  for (const char of text.toLowerCase()) {
    if (/[\s\-_./:()]/.test(char)) {
      previous = '';
      continue;
    }
    const digit = /\d/.test(char);
    if (!previous || digit !== /\d/.test(previous)) starts.add(flat.length);
    flat += char;
    previous = char;
  }
  return { flat, starts };
}

function found(word: string, { flat, starts }: ReturnType<typeof index>): boolean {
  const needle = index(word).flat;
  if (!needle) return true;
  for (let at = flat.indexOf(needle); at !== -1; at = flat.indexOf(needle, at + 1)) {
    if (starts.has(at)) return true;
  }
  return false;
}

/**
 * Every word of the query must start a word somewhere, in any order.
 *
 * Separators are ignored because nobody types a model name the way the
 * catalog punctuates it: "gpt6" must find "GPT-6 Luna", and "qwen 3.8" must
 * find "Qwen3.8 Max". The maker's name counts too, though it appears in
 * neither the id nor the label: "xai" finds Grok.
 */
export function matches(model: CatalogModel, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const brand = brandOf(model);
  const haystack = index(`${model.label} ${model.id} ${brand ? BRAND_NAMES[brand] : ''}`);
  return words.every((word) => found(word, haystack));
}

const byName = (a: CatalogModel, b: CatalogModel) =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
  || hostOf(a.id).localeCompare(hostOf(b.id));

export interface ModelGroup<M extends CatalogModel> {
  key: string;
  /** Null for a flat list, which needs no heading. */
  brand: Brand | 'other' | 'recent' | null;
  models: M[];
}

/**
 * The list as it should be shown.
 *
 * Recent picks lead whenever nothing is typed — they are what you came for
 * most of the time. While searching they step aside: the query already says
 * what you want, and a match listed twice would only confuse the count.
 */
export function arrange<M extends CatalogModel>(
  models: M[],
  { query = '', sort = 'maker', recent = [] }: { query?: string; sort?: SortMode; recent?: string[] } = {},
): ModelGroup<M>[] {
  const found = models.filter((model) => matches(model, query));
  const groups: ModelGroup<M>[] = [];

  if (!query.trim() && recent.length) {
    const byId = new Map(found.map((model) => [model.id, model]));
    const picks = recent.map((id) => byId.get(id)).filter((model): model is M => Boolean(model));
    if (picks.length) groups.push({ key: 'recent', brand: 'recent', models: picks });
  }

  if (sort === 'name') {
    groups.push({ key: 'all', brand: null, models: [...found].sort(byName) });
  } else if (sort === 'context') {
    // Unknown window sorts last: "no number" is not "a small number".
    const size = (model: M) => model.context ?? -1;
    groups.push({ key: 'all', brand: null, models: [...found].sort((a, b) => size(b) - size(a) || byName(a, b)) });
  } else {
    const buckets = new Map<Brand | 'other', M[]>();
    for (const model of found) {
      const brand = brandOf(model) ?? 'other';
      buckets.set(brand, [...(buckets.get(brand) ?? []), model]);
    }
    const order = [...buckets.keys()].sort((a, b) =>
      // "Other" goes last; makers alphabetically, so a group is always
      // where you last saw it.
      a === 'other' ? 1 : b === 'other' ? -1 : BRAND_NAMES[a].localeCompare(BRAND_NAMES[b]));
    for (const brand of order) groups.push({ key: brand, brand, models: buckets.get(brand)!.sort(byName) });
  }

  return groups.filter((group) => group.models.length);
}

/** Most recent first, no repeats, at most three. */
export function remember(recent: string[], id: string, limit = 3): string[] {
  return [id, ...recent.filter((item) => item !== id)].slice(0, limit);
}
