import type { ReplyPart, ToolStep } from './types';

/*
 * A bot reply as a sequence, the way a person texts while working:
 *
 *   "one sec, looking it up"   ← note bubble (said before a tool)
 *   ▸ searching the web …      ← steps
 *   "found three flights"      ← answer bubbles
 *   "the 9:10 is cheapest"
 *
 * The stream builds this live from `note`, tool, `delta` and `break` events;
 * `done` then replaces it with the server's `parts`, which is also what a
 * reopened chat restores.
 */

export type LiveEntry =
  | { kind: 'note'; id: string; bubbles: string[] }
  | { kind: 'steps'; ids: string[] }
  | { kind: 'answer'; bubbles: string[] };

/** Narration arrives as a growing snapshot, so each update replaces its entry. */
export function applyNote(timeline: LiveEntry[], id: string, bubbles: string[]): LiveEntry[] {
  const index = timeline.findIndex((entry) => entry.kind === 'note' && entry.id === id);
  if (index === -1) return [...timeline, { kind: 'note', id, bubbles }];
  return timeline.map((entry, i) => (i === index ? { kind: 'note', id, bubbles } : entry));
}

export function applyStep(timeline: LiveEntry[], stepId: string): LiveEntry[] {
  if (timeline.some((entry) => entry.kind === 'steps' && entry.ids.includes(stepId))) return timeline;
  const last = timeline[timeline.length - 1];
  if (last?.kind === 'steps') return [...timeline.slice(0, -1), { kind: 'steps', ids: [...last.ids, stepId] }];
  return [...timeline, { kind: 'steps', ids: [stepId] }];
}

export function applyDelta(timeline: LiveEntry[], chunk: string): LiveEntry[] {
  if (!chunk) return timeline;
  const index = timeline.findIndex((entry) => entry.kind === 'answer');
  if (index === -1) return [...timeline, { kind: 'answer', bubbles: [chunk] }];
  return timeline.map((entry, i) => {
    if (i !== index || entry.kind !== 'answer') return entry;
    const bubbles = [...entry.bubbles];
    bubbles[bubbles.length - 1] += chunk;
    return { kind: 'answer', bubbles };
  });
}

/** The server only sends a break when text follows it; never open an empty bubble. */
export function applyBreak(timeline: LiveEntry[]): LiveEntry[] {
  return timeline.map((entry) => {
    if (entry.kind !== 'answer' || !entry.bubbles[entry.bubbles.length - 1]?.trim()) return entry;
    return { kind: 'answer', bubbles: [...entry.bubbles, ''] };
  });
}

export function toParts(timeline: LiveEntry[]): ReplyPart[] {
  const parts: ReplyPart[] = [];
  for (const entry of timeline) {
    if (entry.kind === 'steps') {
      parts.push({ type: 'steps', ids: entry.ids });
      continue;
    }
    for (const bubble of entry.bubbles) {
      const text = bubble.trim();
      if (text) parts.push(entry.kind === 'note' ? { type: 'text', text, note: true } : { type: 'text', text });
    }
  }
  return parts;
}

/** The answer alone, joined — what the server stores as `content`. */
export function answerText(timeline: LiveEntry[]): string {
  const answer = timeline.find((entry) => entry.kind === 'answer');
  return answer && answer.kind === 'answer' ? answer.bubbles.map((b) => b.trim()).filter(Boolean).join('\n\n') : '';
}

/**
 * Parts for a saved message. Replies saved before bubbles existed have only
 * `content` and `steps`: they become one steps group and one bubble, which
 * is exactly how they looked then.
 */
export function restoreParts(value: unknown, content: string, steps: ToolStep[]): ReplyPart[] {
  if (Array.isArray(value) && value.length) {
    const parts: ReplyPart[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
        parts.push(item.note ? { type: 'text', text: item.text, note: true } : { type: 'text', text: item.text });
      } else if (item.type === 'steps' && Array.isArray(item.ids)) {
        parts.push({ type: 'steps', ids: item.ids.map(String) });
      }
    }
    if (parts.length) return parts;
  }
  const parts: ReplyPart[] = [];
  if (steps.length) parts.push({ type: 'steps', ids: steps.map((step) => step.id) });
  if (content.trim()) parts.push({ type: 'text', text: content });
  return parts;
}

/** Steps a group refers to, in the group's order; unknown ids are skipped. */
export function stepsFor(ids: string[], steps: ToolStep[]): ToolStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  return ids.map((id) => byId.get(id)).filter((step): step is ToolStep => Boolean(step));
}
