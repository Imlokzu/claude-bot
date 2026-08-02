import { useEffect, useRef, useState, useCallback } from "react";

const WS_PORT = 8001;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

function getWsUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:${WS_PORT}/ws/display`;
}

export function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const attemptsRef = useRef(0);

  const connect = useCallback(() => {
    const scheduleReconnect = () => {
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** attemptsRef.current,
        RECONNECT_MAX_MS
      );
      attemptsRef.current += 1;
      reconnectRef.current = setTimeout(connect, delay);
    };

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      // Всі хендлери ігнорують події від сокета, який уже не є активним
      // (wsRef.current !== ws): у dev під React.StrictMode ефект монтується
      // двічі, і без цього guard-а onclose першого сокета планував реконект —
      // виходило 2 живі сокети (події двічі, send() губився).
      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setConnected(true);
        attemptsRef.current = 0;
        console.log("WebSocket connected");
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(event.data);
          onMessage(msg);
        } catch (err) {
          console.warn("Invalid message:", event.data);
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        // Той самий guard: закриття «знятого» сокета (StrictMode/unmount)
        // штатно генерує error — не засмічуємо консоль хибними помилками.
        if (wsRef.current !== ws) return;
        console.error("WebSocket error:", err);
      };
    } catch (err) {
      console.error("Failed to connect:", err);
      scheduleReconnect();
    }
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      // Знімаємо сокет з ref ДО close() — його onclose побачить, що він
      // більше не активний, і не заплануває реконект (навмисне закриття).
      wsRef.current = null;
      if (ws) ws.close();
      // Guard в onclose пропускає setConnected(false) для знятого сокета —
      // скидаємо статус тут, щоб індикатор не показував «онлайн» після remount
      setConnected(false);
    };
  }, [connect]);

  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, send };
}
