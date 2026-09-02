/**
 * Іконки — ті самі шляхи, що й у веб-панелі (static/icons.js), лише через
 * react-native-svg. Жодних емодзі: їх малює системний шрифт, тому колір,
 * вага й розмір не наші, а на різних платформах вони різні.
 */
import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'chat' | 'code' | 'send' | 'plus' | 'menu' | 'check' | 'close'
  | 'mic' | 'folder' | 'settings' | 'error' | 'stop' | 'trash';

interface Props {
  name: IconName;
  size?: number;
  color: string;
  /** Товщина лінії на сітці 24 — вага Material Symbols Outlined. */
  weight?: number;
}

export function Icon({ name, size = 20, color, weight = 1.7 }: Props) {
  const common = {
    fill: 'none' as const,
    stroke: color,
    strokeWidth: weight,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'chat' && (
        <Path {...common} d="M20 14.5A2.5 2.5 0 0 1 17.5 17H9l-4 3.5V6.5A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5z" />
      )}
      {name === 'code' && (
        <Path {...common} d="m8.6 8.4-4.2 3.7 4.2 3.7M15.4 8.4l4.2 3.7-4.2 3.7M13.4 5.4l-2.8 13.2" />
      )}
      {name === 'send' && <Path {...common} d="M12 19V5M6 11l6-6 6 6" />}
      {name === 'plus' && <Path {...common} d="M12 5v14M5 12h14" />}
      {name === 'menu' && <Path {...common} d="M4 7h16M4 12h16M4 17h16" />}
      {name === 'check' && <Path {...common} d="m5 12.6 4.6 4.4L19 6.8" />}
      {name === 'close' && <Path {...common} d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />}
      {name === 'stop' && <Rect {...common} x={6.5} y={6.5} width={11} height={11} rx={1.6} />}
      {name === 'trash' && (
        <Path {...common} d="M4.5 7h15M9.5 7V5.2h5V7M6.5 7l.9 12A1.6 1.6 0 0 0 9 20.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12M10.2 10.6v6M13.8 10.6v6" />
      )}
      {name === 'mic' && (
        <>
          <Rect {...common} x={9} y={3} width={6} height={10.5} rx={3} />
          <Path {...common} d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.8 21h6.4" />
        </>
      )}
      {name === 'folder' && (
        <Path {...common} d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
      )}
      {name === 'settings' && (
        <>
          <Circle {...common} cx={12} cy={12} r={3.2} />
          <Path {...common} d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
        </>
      )}
      {name === 'error' && (
        <>
          <Circle {...common} cx={12} cy={12} r={8.4} />
          <Path {...common} d="M12 7.6v5M12 16.1h.01" />
        </>
      )}
    </Svg>
  );
}
