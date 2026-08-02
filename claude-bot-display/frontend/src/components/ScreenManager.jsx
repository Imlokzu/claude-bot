import React, { useState, useRef, useCallback } from "react";

const SCREENS = ["status", "face", "transcript", "custom"];
const SCREEN_TITLES = {
  status: "Статус",
  face: "Обличчя",
  transcript: "Розмова",
  custom: "Кастом",
};

export function ScreenManager({
  current,
  onChangeScreen,
  children,
}) {
  const [direction, setDirection] = useState(0);
  const touchStart = useRef(null);

  const switchTo = useCallback(
    (name) => {
      const idx = SCREENS.indexOf(current);
      const nextIdx = SCREENS.indexOf(name);
      setDirection(nextIdx > idx ? 1 : -1);
      onChangeScreen(name);
    },
    [current, onChangeScreen]
  );

  const handleTouchStart = (e) => {
    touchStart.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStart.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(dx) < 40) return;
    const idx = SCREENS.indexOf(current);
    if (dx < 0 && idx < SCREENS.length - 1) {
      switchTo(SCREENS[idx + 1]);
    } else if (dx > 0 && idx > 0) {
      switchTo(SCREENS[idx - 1]);
    }
  };

  const handleMouseDown = (e) => {
    touchStart.current = e.clientX;
  };

  const handleMouseUp = (e) => {
    if (touchStart.current === null) return;
    const dx = e.clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(dx) < 40) return;
    const idx = SCREENS.indexOf(current);
    if (dx < 0 && idx < SCREENS.length - 1) {
      switchTo(SCREENS[idx + 1]);
    } else if (dx > 0 && idx > 0) {
      switchTo(SCREENS[idx - 1]);
    }
  };

  return (
    <div
      className="screen-manager"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      {React.Children.map(children, (child) => {
        const name = child.props.name;
        const isActive = name === current;
        const idx = SCREENS.indexOf(name);
        const curIdx = SCREENS.indexOf(current);
        const isPrev = idx < curIdx;
        return (
          <div className={`screen ${isActive ? "active" : ""} ${isPrev && !isActive ? "prev" : ""}`}>
            {child}
          </div>
        );
      })}
      <div className="dots">
        {SCREENS.map((s) => (
          <button
            key={s}
            className={`dot ${s === current ? "active" : ""}`}
            onClick={() => switchTo(s)}
            aria-label={SCREEN_TITLES[s]}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
          />
        ))}
      </div>
    </div>
  );
}

export { SCREENS, SCREEN_TITLES };
