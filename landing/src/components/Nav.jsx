import { useEffect, useRef, useState } from "react";
import Crab from "../crab/Crab";
import { BRAND } from "../config";
import "./nav.css";

// Project-oriented index for the Claude Bot landing.
// Each entry maps to a scroll position in the fusion field.
const LINKS = [
  { index: "01", label: "Origin / початок", position: 0 },
  { index: "02", label: "Fusion / збірка", position: 0.5 },
  { index: "03", label: "Core / ядро", position: 1 },
];

const MOBILE_QUERY = "(max-width: 760px)";
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const toggleRef = useRef(null);
  const indexRef = useRef(null);
  const firstLinkRef = useRef(null);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const updateViewport = (event) => {
      setIsMobile(event.matches);
      setOpen(false);
    };

    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return undefined;

    const focusTimer = window.setTimeout(() => {
      firstLinkRef.current?.focus({ preventScroll: true });
    }, 0);

    const handleIndexKeys = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }));
        return;
      }

      if (event.key !== "Tab") return;
      const panel = indexRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleIndexKeys);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleIndexKeys);
    };
  }, [isMobile, open]);

  const navigateTo = (position) => {
    window.dispatchEvent(new CustomEvent("landing:navigate", { detail: { position } }));
    setOpen(false);
    if (isMobile) {
      window.requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }));
    }
  };

  const indexClosed = isMobile && !open;

  return (
    <header className="nav">
      <a className="nav__skip" href="#fusion">
        Перейти до поля злиття
      </a>

      <div className="nav__rail nav__rail--left" aria-hidden="true">
        <span className="nav__rail-mark">├</span>
        <span className="nav__rail-line" />
        <span className="nav__rail-coord">Y·00</span>
        <span className="nav__rail-line" />
        <span className="nav__rail-tick nav__rail-tick--long" />
        <span className="nav__rail-line" />
        <span className="nav__rail-coord">Y·50</span>
        <span className="nav__rail-line" />
        <span className="nav__rail-tick nav__rail-tick--long" />
        <span className="nav__rail-line" />
        <span className="nav__rail-coord">Y·99</span>
        <span className="nav__rail-line" />
        <span className="nav__rail-mark">┤</span>
      </div>

      <div className="nav__masthead">
        <button
          className="nav__brand"
          type="button"
          aria-label={`${BRAND.name} — на початок`}
          onClick={() => navigateTo(0)}
        >
          <span className="nav__crab" aria-hidden="true">
            <Crab emotion="idle" static width={64} height={38} style={{ width: 31, height: "auto" }} />
          </span>
          <span className="nav__brand-copy">
            <span className="nav__owner">{BRAND.owner} / AI STUDIO</span>
            <span className="nav__wordmark">{BRAND.name}</span>
          </span>
        </button>
        <span className="nav__edition" aria-hidden="true">
          MK·I<br />26
        </span>
      </div>

      <div className="nav__coordinates" aria-hidden="true">
        <span>WL–CB / 01</span>
        <i />
        <span>ORIGIN / CORE</span>
      </div>

      <button
        ref={toggleRef}
        className="nav__toggle"
        type="button"
        aria-label={open ? "Закрити індекс проєкту" : "Відкрити індекс проєкту"}
        aria-expanded={open}
        aria-controls="project-index"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "[×]" : "[+]"}</span>
        Index
      </button>

      <nav
        ref={indexRef}
        id="project-index"
        className="nav__index"
        aria-label="Індекс проєкту"
        aria-hidden={indexClosed ? "true" : undefined}
        data-open={open ? "true" : "false"}
        inert={indexClosed}
      >
        <div className="nav__index-head" aria-hidden="true">
          <span>PROJECT INDEX</span>
          <span>CB–26</span>
        </div>
        <ol className="nav__list">
          {LINKS.map((link, index) => (
            <li key={link.index}>
              <button
                ref={index === 0 ? firstLinkRef : undefined}
                className="nav__link"
                type="button"
                tabIndex={indexClosed ? -1 : undefined}
                onClick={() => navigateTo(link.position)}
              >
                <span className="nav__link-index">{link.index}</span>
                <span>{link.label}</span>
                <span className="nav__link-mark" aria-hidden="true">↘</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="nav__index-foot" aria-hidden="true">
          <span>FIELD NOTE</span>
          <span>SCROLL / DESCEND</span>
        </div>
      </nav>

      <div className="nav__datum" aria-hidden="true">
        <span>EXPERIMENT 001</span>
        <strong>ONE MIND / THIRTEEN VOICES</strong>
      </div>
    </header>
  );
}
