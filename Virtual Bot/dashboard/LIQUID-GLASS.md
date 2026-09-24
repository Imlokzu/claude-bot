# Liquid glass

A clear lens. The middle stays see-through and the words stay straight. The
rim bends whatever is behind it and catches a bright line of light. It is
not a frosted plate and not a grey card: a white wash on this dark page
reads as a solid fill, so the plate has no fill of its own.

The sample is on the composer, as a plate behind the field, and on the
jump-to-latest circle. Bot replies stay a solid surface: nothing sits
behind them, so a lens there is only a rim around the words. Nothing else
uses it yet.

Do not put this on more surfaces until the owner says the sample looks
right. When they do, add the class and let the existing watcher pick the
element up. Do not invent a second recipe.

## The lens

`src/vendor/hyalite/hyalite.js` is [Hyalite](https://github.com/VII-Cae/hyalite--liquid-glass)
0.5.0, MIT © 2026 VII-Cae (VII). Keep `LICENSE` next to the file. It is one
file, no WebGL. For the element's real size and corner radii it builds a
displacement map, hands it to an SVG filter, and the browser bends the
backdrop through `backdrop-filter: url(#…)`.

`useLiquidGlass` watches the conversation column:

- `.liquid-glass-plate`, a layer behind the composer field — the same lens
  plus a small chromatic fringe. The filter is not on the field. An SVG
  backdrop filter clips the element it belongs to, and on the field that
  cut a tall draft down to the last line.
- the jump circle — a full lens, because the bevel is clamped to the radius

The numbers were chosen by looking at the dark chat, not from the library
defaults. A wide bevel warps the sentence. A dispersion past about half a
pixel turns the line under the field into a rainbow. Do not put those back.

Chromium (Chrome, Edge, Arc, Brave, Android WebView, Electron) paints the
refraction. Safari accepts the property and drops the SVG filter. Firefox
does not implement SVG backdrop filters. Both keep the CSS fallback below,
so the rim is still there. `Hyalite.supported()` is what decides; do not
force it on.

## The class

Defined at the bottom of `src/styles/vendor.css`. Add `liquid-glass` and
remove any opaque background utility (`bg-surface`, `bg-surface-2`) on the
same element, or the fill hides the lens. The watcher attaches on its own
as long as the element sits inside the conversation column.

```css
.liquid-glass {
  background: transparent;
  -webkit-backdrop-filter: var(--hyalite, blur(6px) saturate(1.8));
  backdrop-filter: var(--hyalite, blur(6px) saturate(1.8));
  box-shadow: var(--hyalite-edge,
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 1px 0 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(255, 255, 255, 0.06),
    inset 0 0 0 1px rgba(255, 255, 255, 0.22));
}
```

`--hyalite` and `--hyalite-edge` are written on the element by Hyalite.
Without them the fallback is a small blur and the bright rim. The element's
own text is not blurred. `filter: blur()` would blur the text too, so it is
not part of this recipe.

## Where it falls back to a solid plate

- A browser with neither `backdrop-filter` nor the webkit prefix gets a
  92% surface fill and no blur. The rim stays.
- `prefers-reduced-transparency: reduce` (Windows, macOS, and browsers that
  expose it) turns the plate into an opaque `--c-surface-2`. Do not skip
  this query.

## Rules for applying it later

1. The element has to sit over something. Blur of a flat empty area looks
   like a tint. Scrollable text, a picture, or another panel behind the
   plate is what makes it glass.
2. One plate, not a stack of them. Nested `backdrop-filter` goes muddy and
   is expensive on a phone.
3. Do not animate `backdrop-filter` or `filter`. The panel's motion stays
   on `transform` and `opacity`.
4. Do not use it on the Pi screen (`Virtual Bot/static/screen`). That
   display is 320×240 and does not blur.
5. Keep the radii the component already has. The class does not set one.
6. User bubbles stay the solid ink colour. They are the high-contrast side
   of the thread, not a plate.
