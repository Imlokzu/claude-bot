/*
 * Компоненти з реєстру aicss.dev — «AI-шматки» інтерфейсу агента.
 *
 * Ставились командою `npx shadcn@latest add https://www.aicss.dev/r/<name>.json`,
 * тобто вихідні файли КОПІЮЮТЬСЯ в проєкт і правляться на місці — на відміну
 * від React Bits, які ми тримаємо недоторканими. Що саме змінено, написано в
 * шапці кожного файлу.
 *
 * Джерела:
 *   thinking-reasoning · orbs · file-diff · data-table
 */

export { ThinkingReasoning } from './ThinkingReasoning';
export type { ThinkingReasoningProps } from './ThinkingReasoning';

export { Orb, ORB_TASKS } from './Orb';
export type { OrbProps, OrbVariant } from './Orb';

export { FileDiff, parseUnifiedDiff } from './FileDiff';
export type { DiffRow, DiffRowType } from './FileDiff';

export { DataTable } from './DataTable';
export type { DataTableProps } from './DataTable';
