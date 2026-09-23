/*
 * Turning a written reply into something worth hearing.
 *
 * Markdown read aloud is punctuation soup: the voice pronounces asterisks,
 * hashes and pipes, and a fenced shell script becomes a minute of nonsense.
 * The marks come off, and code blocks are dropped entirely rather than
 * spelled out — if you wanted the code you would read it.
 */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(\*|_)([^*_]+)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
