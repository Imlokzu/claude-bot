import {
  LayoutGrid,
  Brain,
  FolderTree,
  Globe,
  MessageSquare,
  ScrollText,
  Settings,
  Sliders,
  Eye,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Розділи панелі. Порядок тут = порядок у рейці й у нижній навігації. */
export interface SectionDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Ключовий розділ: у вузькому доку лишається на видноті першим. */
  primary?: boolean;
}

export const SECTIONS: SectionDef[] = [
  { id: 'overview', label: 'Огляд', icon: LayoutGrid, primary: true },
  { id: 'chat', label: 'Чат', icon: MessageSquare, primary: true },
  { id: 'memory', label: "Пам'ять", icon: Brain, primary: true },
  { id: 'files', label: 'Файли', icon: FolderTree, primary: true },
  { id: 'browser', label: 'Браузер', icon: Globe },
  { id: 'vision', label: 'Зір', icon: Eye },
  { id: 'services', label: 'Сервіси', icon: Sliders },
  { id: 'logs', label: 'Логи', icon: ScrollText },
  { id: 'settings', label: 'Налаштування', icon: Settings, primary: true },
];

export const SECTION_IDS = SECTIONS.map((section) => section.id);
export const DEFAULT_SECTION = 'overview';

export function findSection(id: string): SectionDef {
  return SECTIONS.find((section) => section.id === id) ?? SECTIONS[0];
}
