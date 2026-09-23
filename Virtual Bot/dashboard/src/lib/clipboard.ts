/*
 * Copying text, including where the modern way is unavailable.
 *
 * `navigator.clipboard` only exists in a secure context. The panel is served
 * over plain HTTP whenever the bot is reached by its address on the network
 * rather than at localhost — which is the normal way to open it from the
 * couch — and there the modern API is simply not defined. A copy button that
 * quietly does nothing on every device except the owner's laptop is worse
 * than no button, so the deprecated path stays as the fallback.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied or a non-focused document — try the old way.
    }
  }

  const field = document.createElement('textarea');
  field.value = text;
  // Off-screen rather than hidden: `display: none` cannot be selected, and
  // `readOnly` keeps the mobile keyboard from appearing for an instant.
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw new Error('execCommand("copy") refused');
  } finally {
    field.remove();
  }
}
