/** Дрібні перетворення для показу. */

/**
 * Підпис моделі без префікса провайдера: «opencode-go/kimi-k3» → «kimi-k3».
 *
 * У закритому пікері провайдер однаковий майже в усіх пунктах і лише з'їдає
 * ширину — особливо на телефоні. У відкритому списку й у підказці повний
 * ідентифікатор лишається: там він потрібен, щоб відрізнити двійники
 * (напр. платний «opencode/muse-spark-1.2» від безкоштовного).
 */
export function shortModelName(name: string): string {
  const text = String(name ?? '');
  const slash = text.lastIndexOf('/');
  return slash === -1 ? text : text.slice(slash + 1);
}
