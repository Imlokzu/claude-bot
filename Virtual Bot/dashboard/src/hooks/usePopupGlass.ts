import { useEffect } from 'react';
import '@/vendor/hyalite/hyalite.js';
import type { HyaliteOptions } from '@/vendor/hyalite/hyalite.js';

/*
 * Popups keep their solid plate. Glass is a second material, switched in
 * Look, and it only paints while html[data-popup="glass"] is set.
 *
 * Radix positions a menu by transforming an outer wrapper. A lens inside
 * that wrapper cannot see the page, so the card stays dark. The lens goes
 * on the wrapper. Menus with no transformed parent (the command palette,
 * the prompt bar) carry the lens themselves.
 */
const lens: HyaliteOptions = {
  bevel: 10,
  thickness: 46,
  slope: 1.4,
  shape: 'squircle',
  blur: 6,
  dispersion: 0.4,
  shade: 0.34,
  rim: 2.2,
  edgeW: 6,
  sat: 0.95,
  edge: 1.05,
  light: -16,
  smooth: 0,
  settle: 80,
};

function glassOn(): boolean {
  return document.documentElement.dataset.popup === 'glass';
}

function armShell(shell: Element) {
  const wrap = shell.closest('[data-radix-popper-content-wrapper]');
  const target = (wrap ?? shell) as HTMLElement;
  if (wrap) {
    const radius = getComputedStyle(shell).borderRadius;
    if (radius) target.style.borderRadius = radius;
  }
  target.classList.add('popup-lens');
}

function armMenu(menu: Element) {
  menu.classList.add('popup-shell');
  menu.setAttribute('data-popup-armed', '');
  menu.querySelector(':scope > .popup-plate[data-injected]')?.remove();
  armShell(menu);
}

function armTree(root: ParentNode) {
  root.querySelectorAll('.prompt-bar__menu').forEach(armMenu);
  root.querySelectorAll('.popup-shell').forEach(armShell);
}

function disarm() {
  document.querySelectorAll('.popup-lens').forEach((node) => {
    node.classList.remove('popup-lens');
    if (node instanceof HTMLElement && node.hasAttribute('data-radix-popper-content-wrapper')) {
      node.style.borderRadius = '';
    }
  });
  document.querySelectorAll('.prompt-bar__menu[data-popup-armed]').forEach((menu) => {
    menu.querySelector(':scope > .popup-plate[data-injected]')?.remove();
    menu.classList.remove('popup-shell');
    menu.removeAttribute('data-popup-armed');
  });
}

export function usePopupGlass() {
  useEffect(() => {
    let watcher: { stop(): void } | null = null;
    let observer: MutationObserver | null = null;

    const stop = () => {
      watcher?.stop();
      watcher = null;
      observer?.disconnect();
      observer = null;
      disarm();
    };

    const start = () => {
      stop();
      if (!glassOn()) return;
      if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
      const Hyalite = window.Hyalite;
      if (!Hyalite?.supported()) return;
      const armNode = (node: Element) => {
        if (node.matches('.prompt-bar__menu')) armMenu(node);
        else if (node.matches('.popup-shell')) armShell(node);
        node.querySelectorAll('.prompt-bar__menu').forEach(armMenu);
        node.querySelectorAll('.popup-shell').forEach(armShell);
      };
      armTree(document.body);
      observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) armNode(node);
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      watcher = Hyalite.watch(document.body, '.popup-lens', lens);
    };

    start();
    window.addEventListener('vbot:popup', start);
    return () => {
      window.removeEventListener('vbot:popup', start);
      stop();
    };
  }, []);
}
