# Liquid glass

A frosted plate: the surface is translucent, what sits behind it is blurred,
and a thin light edge makes it read as glass. The sample is on the bot's
chat bubbles and on the composer field. Nothing else uses it yet.

Do not put this on more surfaces until the owner says the sample looks
right. When they do, apply the class below. Do not invent a second recipe.

## Not an iOS material

Apple's liquid glass (`UIVisualEffect`, SwiftUI `glassEffect`) exists only
on Apple platforms. This panel also runs in Chrome and Firefox on Windows
and Linux, and in Chrome and WebView on Android. The effect is therefore
plain CSS, which those engines already implement:

- `backdrop-filter: blur(22px) saturate(1.6)` blurs and slightly enriches
  whatever is painted behind the element.
- `-webkit-backdrop-filter` is the same declaration for Safari and for
  older Android WebViews that still need the prefix.
- The element's own text is not blurred. `filter: blur()` would blur the
  text too, so it is not part of this recipe.
- A solid `color-mix` fill sits under the blur so the plate is still a
  plate when the backdrop is a flat colour.
- `box-shadow` draws the hairline rim and the top highlight. Do not add a
  second border utility on top of it.

## The class

Defined at the bottom of `src/styles/vendor.css`. Add `liquid-glass` and
remove any opaque background utility (`bg-surface`, `bg-surface-2`) on the
same element, or the fill hides the blur.

```css
.liquid-glass {
  background: rgba(28, 24, 20, 0.72);
  background: color-mix(in srgb, var(--c-surface) 62%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
  backdrop-filter: blur(22px) saturate(1.6);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white 38%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--c-text) 12%, transparent);
}
```

The first `background` is the fallback for an engine that does not
understand `color-mix`. The second line replaces it where `color-mix`
works (current Chrome, Edge, Firefox, Safari).

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
