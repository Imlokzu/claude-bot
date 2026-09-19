import type { OrbVariant } from '@/vendor/aicss';

/*
 * Що саме робить бот — людською мовою.
 *
 * У подіях SSE приходить технічне імʼя тулза (`web_search`, `workspace_write`).
 * Показувати його як є означає вимагати від людини знати наш реєстр тулзів,
 * тому тут воно перекладається в дію та в орб, що цю дію зображає.
 *
 * Орби — aicss.dev/r/orbs: у кожного свій рух, і саме рух розрізняє «шукаю»
 * від «пишу» швидше за підпис. Варіанти взяті за змістом (ORB_TASKS):
 * S4 Searching, S3 Working, G3 Uploading, C4 Analyzing, B3 Generating,
 * C2 Listening, S1 Thinking.
 */

export interface ToolLook {
  /** Дієслово теперішнього часу: «шукаю в інтернеті». */
  verb: string;
  orb: OrbVariant;
}

const LOOKS: Record<string, ToolLook> = {
  web_search: { verb: 'шукаю в інтернеті', orb: 'S4' },
  image_search: { verb: 'шукаю картинки', orb: 'S4' },
  facts: { verb: 'звіряюсь із Вікіпедією', orb: 'C4' },
  weather: { verb: 'дивлюсь погоду', orb: 'C4' },
  currency: { verb: 'дивлюсь курс', orb: 'C4' },
  memory_search: { verb: 'згадую', orb: 'S1' },

  create_brain_directory: { verb: 'створюю теку в памʼяті', orb: 'G3' },
  create_brain_file: { verb: 'пишу нотатку', orb: 'G3' },
  list_brain_navigation: { verb: 'переглядаю памʼять', orb: 'S1' },

  workspace_show: { verb: 'відкриваю файл', orb: 'C4' },
  workspace_info: { verb: 'дивлюсь на файл', orb: 'C4' },
  workspace_list: { verb: 'переглядаю теку', orb: 'C4' },
  workspace_read: { verb: 'читаю файл', orb: 'C4' },
  workspace_write: { verb: 'пишу у файл', orb: 'G3' },
  workspace_mkdir: { verb: 'створюю теку', orb: 'G3' },
  workspace_delete: { verb: 'видаляю', orb: 'G3' },

  ask_question: { verb: 'питаю тебе', orb: 'C2' },
  todo_list: { verb: 'складаю список', orb: 'B3' },
  show_choice: { verb: 'пропоную вибір', orb: 'C2' },

  open_screen: { verb: 'вмикаю екран', orb: 'S3' },
  play_music: { verb: 'вмикаю музику', orb: 'C3' },
  stop_music: { verb: 'вимикаю музику', orb: 'S3' },
  listen_to_video: { verb: 'слухаю відео', orb: 'C2' },
  play_video: { verb: 'вмикаю відео', orb: 'C3' },
  video_control: { verb: 'керую відтворенням', orb: 'S3' },
  video_status: { verb: 'перевіряю відтворення', orb: 'C4' },
  video_settings: { verb: 'налаштовую відтворення', orb: 'S3' },
};

const FALLBACK: ToolLook = { verb: 'працюю', orb: 'S3' };

export function toolLook(name: string): ToolLook {
  return LOOKS[name] ?? FALLBACK;
}

/** Рядок кроку: «шукаю в інтернеті — нова тварина Болівія». */
export function stepLine(name: string, detail: string): string {
  const { verb } = toolLook(name);
  return detail ? `${verb} — ${detail}` : verb;
}
