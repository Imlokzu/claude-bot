import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

/*
 * Запобіжник розділу.
 *
 * Без нього будь-яка помилка в одному розділі розмонтовувала все дерево, і
 * панель ставала порожнім чорним екраном — без натяку, що саме сталось.
 * Тепер падає лише той розділ, а причина видно одразу.
 */
interface State {
  error: Error | null;
}

export class PanelBoundary extends Component<{ children: ReactNode; section: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Розділ «${this.props.section}» впав`, error, info.componentStack);
  }

  componentDidUpdate(prev: { section: string }): void {
    // Перехід в інший розділ має давати чистий старт, а не лишати помилку
    // попереднього на екрані.
    if (prev.section !== this.props.section && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="u-measure w-full max-w-md rounded-lg border border-err/40 bg-surface p-5">
          <p className="u-label mb-2 text-err">розділ впав</p>
          <p className="text-sm text-ink">
            Щось зламалось у розділі «{this.props.section}». Решта панелі працює.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-sm bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
              Спробувати ще раз
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
              Перезавантажити
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
