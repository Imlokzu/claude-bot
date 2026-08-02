import React, { useEffect, useState } from "react";

const BITMAPS = {
  neutral: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
  ],
  idle: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    "......",
  ],
  listening: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    "######",
    ".####.",
  ],
  thinking: [
    "......",
    ".####.",
    ".####.",
    "######",
    "######",
    "######",
    ".####.",
    "......",
  ],
  speaking: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    ".####.",
  ],
  happy: [
    "......",
    "......",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
    "......",
  ],
  excited: [
    "......",
    "######",
    "######",
    "######",
    "######",
    "######",
    "######",
    ".####.",
  ],
  surprised: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    "######",
    ".####.",
  ],
  shocked: [
    "......",
    "######",
    "######",
    "######",
    "######",
    "######",
    "######",
    "######",
  ],
  angry: [
    "##..##",
    "###.##",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
    "......",
  ],
  sad: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
  ],
  sleepy: [
    "......",
    "......",
    ".####.",
    "######",
    "######",
    "######",
    ".####.",
    "......",
  ],
  confused: [
    "......",
    ".####.",
    "######",
    "##..##",
    "##..##",
    "######",
    ".####.",
    "..##..",
  ],
  love: [
    "......",
    ".#..#.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
  ],
  suspicious: [
    "......",
    "####..",
    "#####.",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
  ],
};

const EMOTION_LABELS = {
  neutral: "Спокій",
  idle: "Очікування",
  listening: "Слухаю",
  thinking: "Думаю",
  speaking: "Говорю",
  happy: "Радісний",
  excited: "Захоплений",
  surprised: "Здивований",
  shocked: "Шокований",
  angry: "Злий",
  sad: "Сумний",
  sleepy: "Сонний",
  confused: "Збитий з пантелику",
  love: "Закоханий",
  suspicious: "Підозрілий",
};

export function PixelEyes({ emotion = "neutral", size = 10, gap = 2 }) {
  const [blinking, setBlinking] = useState(false);
  const bitmap = BITMAPS[emotion] || BITMAPS.neutral;
  const rows = bitmap.length;
  const cols = bitmap[0].length;

  useEffect(() => {
    const scheduleBlink = () => {
      const delay = 2000 + Math.random() * 4000;
      return setTimeout(() => {
        setBlinking(true);
        setTimeout(() => setBlinking(false), 150);
        scheduleBlink();
      }, delay);
    };
    const timer = scheduleBlink();
    return () => clearTimeout(timer);
  }, []);

  const renderEye = (mirror) => {
    const pixels = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const colIndex = mirror ? cols - 1 - c : c;
        const isOn = bitmap[r][colIndex] === "#";
        const key = `${r}-${c}-${mirror ? "R" : "L"}`;
        pixels.push(
          <div
            key={key}
            className={`pixel ${isOn && !blinking ? "on" : "off"}`}
            style={{ width: size, height: size }}
          />
        );
      }
    }
    return pixels;
  };

  const eyeStyle = {
    gridTemplateColumns: `repeat(${cols}, ${size}px)`,
    gap: `${gap}px`,
  };

  return (
    <div className="face-container">
      <div className="eyes-row">
        <div className="pixel-eye" style={eyeStyle}>
          {renderEye(false)}
        </div>
        <div className="pixel-eye" style={eyeStyle}>
          {renderEye(true)}
        </div>
      </div>
      <div className="face-status">{EMOTION_LABELS[emotion] || emotion}</div>
    </div>
  );
}

export const EMOTIONS = Object.keys(BITMAPS);
