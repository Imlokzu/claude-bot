import { useRef, useState } from 'react';
import { ArrowRight, RotateCw } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Empty } from '@/components/ui/Feedback';
import { Globe } from 'lucide-react';
import { glue } from '@/lib/glue';
import { SectionHeader } from '@/components/shell/SectionHeader';

/*
 * Вбудований браузер.
 *
 * Сторінку тягне бекенд (/api/browser/page), а не iframe напряму: більшість
 * сайтів забороняє вбудовування через X-Frame-Options та CSP, тож прямий
 * iframe показував би порожнечу. Запит, який не схожий на адресу, бекенд сам
 * перетворює на сторінку результатів пошуку.
 */
export default function BrowserPanel() {
  const [query, setQuery] = useState('');
  const [src, setSrc] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const open = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSrc(`/api/browser/page?url=${encodeURIComponent(trimmed)}&t=${Date.now()}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
      <SectionHeader className="mb-2" label="БРАУЗЕР" title="Сторінка очима бота" />
      <form
        className="flex shrink-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          open(query);
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Адреса або пошуковий запит"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="submit" variant="solid" size="icon" aria-label="Відкрити">
          <ArrowRight />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Оновити"
          disabled={!src}
          onClick={() => open(query)}
        >
          <RotateCw />
        </Button>
      </form>

      <Panel flush className="min-h-0 flex-1 overflow-hidden">
        {src ? (
          <iframe
            ref={frameRef}
            src={src}
            title="Вбудований браузер"
            className="size-full border-0 bg-white"
            // Сторінка чужа: лишаємо їй скрипти й форми, але не даємо
            // виривати нас із рамки й ходити в наш origin.
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        ) : (
          <Empty
            icon={Globe}
            title="Нічого не відкрито"
            hint={glue('Введи адресу або запит — сторінку завантажить бекенд, бо в iframe більшість сайтів не пускає.')}
          />
        )}
      </Panel>
    </div>
  );
}
