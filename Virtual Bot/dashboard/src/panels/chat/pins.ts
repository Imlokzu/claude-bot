export const PIN_IDS = ['projects', 'vision', 'screen'] as const;
export type PinId = typeof PIN_IDS[number];
export const PINS_KEY = 'claudeBotChatPins';

/** Corrupt or outdated preferences must not make the conversation inaccessible. */
export function parsePins(saved: string | null): PinId[] {
  try {
    const value: unknown = JSON.parse(saved ?? '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is PinId => PIN_IDS.includes(id)))];
  } catch {
    return [];
  }
}
