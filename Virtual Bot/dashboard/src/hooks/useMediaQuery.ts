import { useEffect, useState } from 'react';

/** Порогові точки панелі — ті самі, що описані в DESIGN.md. */
export const BREAKPOINTS = {
  phone: '(max-width: 759px)',
  tablet: '(min-width: 760px) and (max-width: 1179px)',
  desk: '(min-width: 1180px)',
} as const;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export const useIsPhone = () => useMediaQuery(BREAKPOINTS.phone);
export const useIsDesk = () => useMediaQuery(BREAKPOINTS.desk);
