import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SECTION, SECTION_IDS } from './sections';

/*
 * Маршрут — у хеші. Повноцінний роутер тут зайвий: розділів вісім, вкладеності
 * немає, а хеш дає те, заради чого роутер і беруть — посилання на розділ,
 * кнопку «назад» і збереження місця при перезавантаженні.
 */

function read(): string {
  const id = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return SECTION_IDS.includes(id) ? id : DEFAULT_SECTION;
}

export function useRoute(): [string, (id: string) => void] {
  const [section, setSection] = useState(read);

  useEffect(() => {
    const onHashChange = () => setSection(read());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((id: string) => {
    window.location.hash = `#/${id}`;
  }, []);

  return [section, navigate];
}

/**
 * Значення з хвоста хеша: `#/chat?project=cats`.
 *
 * Розділ і його параметр живуть в одному місці — тоді посилання на «чати
 * проєкту» лишається звичайним посиланням, а кнопка «назад» повертає не лише
 * розділ, а й те, що в ньому було відкрито.
 */
export function useRouteParam(name: string): string {
  const [value, setValue] = useState(() => readParam(name));

  useEffect(() => {
    const onHashChange = () => setValue(readParam(name));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [name]);

  return value;
}

function readParam(name: string): string {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get(name) ?? '';
}
