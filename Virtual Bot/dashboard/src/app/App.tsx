import { Suspense, lazy } from 'react';
import { ClickSpark } from '@/vendor/reactbits';
import { Topbar } from '@/components/shell/Topbar';
import { DockNav } from '@/components/shell/DockNav';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { PanelBoundary } from '@/components/shell/PanelBoundary';
import { Loader } from '@/components/ui/Status';
import { useAccentColor } from '@/hooks/useAccentRgb';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRoute } from './useRoute';

/*
 * Розділи вантажаться ліниво. Це не мікрооптимізація: чат тягне за собою
 * assistant-ui, памʼять — Tiptap, файли — CodeMirror. В одному бандлі перший
 * екран чекав би на редактори, яких може не відкрити ніхто за весь сеанс.
 */
const PANELS: Record<string, React.LazyExoticComponent<() => React.ReactElement>> = {
  overview: lazy(() => import('@/panels/overview/OverviewPanel')),
  chat: lazy(() => import('@/panels/chat/ChatPanel')),
  memory: lazy(() => import('@/panels/memory/MemoryPanel')),
  files: lazy(() => import('@/panels/files/FilesPanel')),
  browser: lazy(() => import('@/panels/browser/BrowserPanel')),
  vision: lazy(() => import('@/panels/vision/VisionPanel')),
  services: lazy(() => import('@/panels/services/ServicesPanel')),
  logs: lazy(() => import('@/panels/logs/LogsPanel')),
  settings: lazy(() => import('@/panels/settings/SettingsPanel')),
};

export function App() {
  const [section, navigate] = useRoute();
  const accent = useAccentColor();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  const Panel = PANELS[section] ?? PANELS.overview;

  const tree = (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Topbar />

      {/* Док плаває над вмістом, тож нижній відступ лишаємо тут, один раз,
          а не в кожному розділі окремо. */}
      {/* Місце під док лишає CSS за атрибутом data-dock на <html> — саме
          тому, що док переносний: інакше довелось би протягувати його бік
          через усі розділи. */}
      <main className="u-under-dock flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PanelBoundary section={section}>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Loader label="Відкриваю розділ" showTimer={false} />
              </div>
            }
          >
            <Panel key={section} />
          </Suspense>
        </PanelBoundary>
      </main>

      <DockNav current={section} onNavigate={navigate} />
      <CommandPalette />
    </div>
  );

  // Іскра на кожен клік — єдиний глобальний ефект панелі. Дає фізичність
  // дотику там, де інакше нічого не відповідає: у порожньому полі, на
  // плитці, на тлі. Під prefers-reduced-motion вимикається повністю.
  if (reduced) return tree;

  return (
    <ClickSpark sparkColor={accent} sparkSize={7} sparkRadius={13} sparkCount={7} duration={380}>
      {tree}
    </ClickSpark>
  );
}
