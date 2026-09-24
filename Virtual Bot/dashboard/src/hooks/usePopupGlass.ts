import { useEffect } from 'react';
import '@/vendor/hyalite/hyalite.js';
import type { HyaliteOptions } from '@/vendor/hyalite/hyalite.js';

/*
 * Popups keep their solid plate. Glass is a second material, switched in
 * Look, and it only paints while html[data-popup="glass"] is set.
 *
 * The lens is a plate behind the menu, same as the composer: the filter
 * clips whatever element it is attached to, and a menu's own text has to
 * stay outside that element.
 */
const lens: HyaliteOptions = {
  bevel: 10,
  thickness: 46,
  slope: 1.4,
  shape: 'squircle',
  blur: 0,
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

function armMenu(menu: Element) {
  if (menu.querySelector(':scope > .popup-plate')) return;
  menu.classList.add('popup-shell');
  menu.setAttribute('data-popup-armed', '');
  const plate = document.createElement('div');
  plate.className = 'popup-plate liquid-glass';
  plate.setAttribute('aria-hidden', 'true');
  plate.setAttribute('data-injected', '');
  menu.prepend(plate);
}

function armMenus(root: ParentNode) {
  root.querySelectorAll('.prompt-bar__menu').forEach(armMenu);
}

function disarmMenus() {
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
      disarmMenus();
    };

    const start = () => {
      stop();
      if (!glassOn()) return;
      if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
      const Hyalite = window.Hyalite;
      if (!Hyalite?.supported()) return;
      armMenus(document.body);
      observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node.matches('.prompt-bar__menu')) armMenu(node);
            else node.querySelectorAll('.prompt-bar__menu').forEach(armMenu);
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      watcher = Hyalite.watch(document.body, '.popup-plate', lens);
    };

    start();
    window.addEventListener('vbot:popup', start);
    return () => {
      window.removeEventListener('vbot:popup', start);
      stop();
    };
  }, []);
}
