# Liquid glass

A clear lens, in the spirit of Apple's glass: the middle stays see-through,
what is behind it is only slightly softened and more colourful, and a bright
rim catches the light. It is not a frosted plate. A heavy blur plus a dark
fill turns it milky; do not put that back.

The sample is on the bot's chat bubbles, the composer field, and the
jump-to-latest circle. Nothing else uses it yet.

Do not put this on more surfaces until the owner says the sample looks
right. When they do, apply the class below. Do not invent a second recipe.

## Not an iOS material

Apple's liquid glass (`UIVisualEffect`, SwiftUI `glassEffect`) exists only
on Apple platforms. This panel also runs in Chrome and Firefox on Windows
and Linux, and in Chrome and WebView on Android. The effect is therefore
plain CSS, which those engines already implement:

- `backdrop-filter: blur(8px) saturate(1.9)` softens and enriches whatever
  is painted behind the element. Keep the blur small. Past ~12px it
  becomes frost.
- `-webkit-backdrop-filter` is the same declaration for Safari and for
  older Android WebViews that still need the prefix.
- The element's own text is not blurred. `filter: blur()` would blur the
  text too, so it is not part of this recipe.
- The fill is a faint white sheen, stronger at the top edge, not a tint of
  `--c-surface`. A surface-coloured fill is what made the first version
  look muddy.
- `box-shadow` draws the bright top lip, the darker lower lip, and the
  hairline rim. That rim is the Apple cue. Do not add a second border
  utility on top of it.

## The class

Defined at the bottom of `src/styles/vendor.css`. Add `liquid-glass` and
remove any opaque background utility (`bg-surface`, `bg-surface-2`) on the
same element, or the fill hides the blur.

```css
.liquid-glass {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.22),
    rgba(255, 255, 255, 0.05) 38%,
    rgba(255, 255, 255, 0.02)
  );
  -webkit-backdrop-filter: blur(8px) saturate(1.9);
  backdrop-filter: blur(8px) saturate(1.9);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18),
    inset 0 0 0 1px rgba(255, 255, 255, 0.32),
    0 10px 24px rgba(0, 0, 0, 0.12);
}
```

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
