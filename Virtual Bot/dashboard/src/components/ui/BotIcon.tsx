/** Static idle sprite from vendor/pixelcrab/crab.js, on the same 10×8 grid.
 * Keep chat avatars lightweight: only the sidebar face needs a canvas loop.
 */
export function BotIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 8"
      width={20}
      height={16}
      className={`shrink-0 text-accent ${className}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      data-bot-icon=""
    >
      <g fill="currentColor">
        <rect x="1" y="0" width="8" height="5" />
        <rect x="0" y="3" width="10" height="1" />
        <rect x="1" y="5" width="1" height="3" />
        <rect x="3" y="5" width="1" height="3" />
        <rect x="6" y="5" width="1" height="3" />
        <rect x="8" y="5" width="1" height="3" />
      </g>
      <g fill="#141414">
        <rect x="2" y="1" width="1" height="1" />
        <rect x="7" y="1" width="1" height="1" />
      </g>
    </svg>
  );
}
