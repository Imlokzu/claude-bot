import { useCallback, useEffect, useRef, useState } from "react";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/react";
import { useWebSocket } from "./hooks/useWebSocket";
import { ScreenManager } from "./components/ScreenManager";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WeatherWidget } from "./components/WeatherWidget";
import { ClockWidget } from "./components/ClockWidget";
import { StatusScreen } from "./screens/StatusScreen";
import { FaceScreen } from "./screens/FaceScreen";
import { TranscriptScreen } from "./screens/TranscriptScreen";
import { CustomScreen } from "./screens/CustomScreen";

const DEFAULT_SCREEN = "face";
const IDLE_TIMEOUT_MS = 10000;
const SCREEN_W = 320;
const SCREEN_H = 240;
const BEZEL_H = 60;

function formatTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function computeScale() {
  const padding = 64;
  const availW = window.innerWidth - padding;
  const availH = window.innerHeight - padding;
  const scaleW = availW / SCREEN_W;
  const scaleH = availH / (SCREEN_H + BEZEL_H);
  return Math.min(scaleW, scaleH, 2.2);
}

export default function App() {
  const [scale, setScale] = useState(computeScale);
  const [currentScreen, setCurrentScreen] = useState(DEFAULT_SCREEN);
  const [emotion, setEmotion] = useState("neutral");
  const [state, setState] = useState({});
  const [weather, setWeather] = useState(null);
  const [clock, setClock] = useState(null);
  const [heard, setHeard] = useState("");
  const [speaking, setSpeaking] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [custom, setCustom] = useState({ contentType: "", content: "" });
  const [timerSeconds, setTimerSeconds] = useState(null);
  // Покоління таймера: рестарт з тим самим числом секунд дає
  // setTimerSeconds(те саме значення) → React bail-out → ефект відліку
  // не перезапускається і тік не планується (відлік замерзає). Інкремент
  // покоління на кожному show_custom гарантує перезапуск ефекту.
  const [timerGen, setTimerGen] = useState(0);
  const [alarm, setAlarm] = useState(null);
  const idleTimer = useRef(null);
  // Окремий таймер автоповернення custom-екрана (duration_seconds)
  const customTimer = useRef(null);
  // true — custom-екран керується duration_seconds, resetIdle його не чіпає
  const customHold = useRef(false);
  // Кінцевий timestamp відліку таймера — щоб тік не дрейфував
  const timerEndRef = useRef(null);

  const handleMessage = useCallback((msg) => {
    const { type, data } = msg;
    switch (type) {
      case "state_update":
        setState(data);
        break;
      case "emotion_change":
        setEmotion(data.emotion || "neutral");
        break;
      case "heard":
        setHeard(data.text || "");
        setSpeaking("");
        setIsStreaming(false);
        setCurrentScreen("transcript");
        releaseCustomHold(); // екран замінили — hold custom-екрана закінчився
        resetIdle();
        break;
      case "speaking":
        setSpeaking(data.text || "");
        setIsStreaming(false);
        resetIdle();
        break;
      case "speaking_chunk":
        setSpeaking((prev) => prev + (data.text || ""));
        setIsStreaming(true);
        setCurrentScreen("transcript");
        releaseCustomHold(); // екран замінили — hold custom-екрана закінчився
        resetIdle();
        break;
      case "speaking_end":
        setIsStreaming(false);
        resetIdle();
        break;
      case "show_custom": {
        const contentType = data.content_type || "text";
        const content = data.content || "";
        const secs =
          contentType === "timer" ? Math.max(parseInt(content, 10) || 0, 0) : null;
        setCustom({ contentType, content });
        setTimerSeconds(secs);
        setTimerGen((g) => g + 1);
        // Відлік ведемо від кінцевого timestamp, а не ланцюжком setTimeout(1000)
        timerEndRef.current = secs === null ? null : Date.now() + secs * 1000;
        setAlarm(null);
        setCurrentScreen("custom");
        scheduleReturn(Number(data.duration_seconds) || 0);
        break;
      }
      case "weather_update":
        setWeather(data);
        break;
      case "clock_tick":
        setClock(data);
        break;
      case "alarm_triggered":
        setAlarm({ id: data.id, label: data.label });
        setCurrentScreen("custom");
        releaseCustomHold(); // будильник замінює custom-контент, керується idle-таймером
        resetIdle();
        break;
      default:
        break;
    }
  }, []);

  const { connected, send } = useWebSocket(handleMessage);

  const returnToFace = () => {
    customHold.current = false;
    if (customTimer.current) clearTimeout(customTimer.current);
    customTimer.current = null;
    setCurrentScreen(DEFAULT_SCREEN);
    setAlarm(null);
  };

  const resetIdle = () => {
    // Поки custom-екран під hold (duration_seconds) — idle-таймер його не чіпає
    if (customHold.current) return;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(returnToFace, IDLE_TIMEOUT_MS);
  };

  // Зняти hold: екран «замінили», duration_seconds більше не керує
  const releaseCustomHold = () => {
    customHold.current = false;
    if (customTimer.current) clearTimeout(customTimer.current);
    customTimer.current = null;
  };

  // Per API_CONTRACT.md: duration_seconds 0 — show until replaced,
  // positive — auto-return to face after N seconds.
  const scheduleReturn = (durationSeconds) => {
    customHold.current = true;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (customTimer.current) clearTimeout(customTimer.current);
    customTimer.current = null;
    if (durationSeconds > 0) {
      customTimer.current = setTimeout(returnToFace, durationSeconds * 1000);
    }
  };

  const handleChangeScreen = useCallback(
    (name) => {
      setCurrentScreen(name);
      send({
        type: "swipe",
        data: { from_screen: currentScreen, to_screen: name, direction: "left" },
      });
      releaseCustomHold(); // користувач сам змінив екран — hold закінчився
      resetIdle();
    },
    [currentScreen, send]
  );

  useEffect(() => {
    if (timerSeconds === null || timerSeconds <= 0 || timerEndRef.current === null)
      return undefined;
    // Затримка до наступної межі секунди ВІД кінцевого timestamp + ~50мс буфер.
    // Буфер критичний: без нього Math.ceil може дати те саме значення,
    // ефект (залежить від [timerSeconds]) не перезапуститься — відлік зупиниться.
    const msLeft = timerEndRef.current - Date.now();
    const delay = ((((msLeft % 1000) + 1000) % 1000) || 1000) + 50;
    const tick = setTimeout(() => {
      // Гонка: show_custom(text) синхронно нулить timerEndRef, але cleanup
      // ефекту зніме цей тік лише на коміті — до того тік міг би записати 0
      // поверх null (null - Date.now() → від'ємне → 0). Ігноруємо знятий відлік.
      if (timerEndRef.current === null) return;
      setTimerSeconds(
        Math.max(0, Math.ceil((timerEndRef.current - Date.now()) / 1000))
      );
    }, delay);
    return () => clearTimeout(tick);
    // timerGen у deps: перезапуск тіка при рестарті таймера з тим самим значенням
  }, [timerSeconds, timerGen]);

  useEffect(() => {
    const onResize = () => setScale(computeScale());
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (customTimer.current) clearTimeout(customTimer.current);
    };
  }, []);

  return (
    <div className="device-stage">
      <div className="device-frame" style={{ transform: `scale(${scale})` }}>
        <div className="device-bezel">
          <div className="device-brand">КЛОД БОТ</div>
          <div className="device-camera" />
        </div>
        <div className="device-screen">
          <div className="app">
            <header className="app-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <WeatherWidget weather={weather} compact />
                <ClockWidget clock={clock} compact />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Show when="signed-out">
                  <SignInButton />
                  <SignUpButton />
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
                <div className={`connection-dot ${connected ? "online" : "offline"}`} />
              </div>
            </header>

            <ErrorBoundary>
              <ScreenManager current={currentScreen} onChangeScreen={handleChangeScreen}>
                <div name="status">
                  <StatusScreen state={state} />
                </div>
                <div name="face">
                  <FaceScreen emotion={emotion} />
                </div>
                <div name="transcript">
                  <TranscriptScreen
                    heard={heard}
                    speaking={speaking}
                    isStreaming={isStreaming}
                  />
                </div>
                <div name="custom">
                  <CustomScreen
                    contentType={custom.contentType}
                    content={custom.content}
                    timerText={timerSeconds === null ? "" : formatTimer(timerSeconds)}
                    alarm={alarm}
                  />
                </div>
              </ScreenManager>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
