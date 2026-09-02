import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Select, Switch, Tooltip } from 'antd';
import {
  AudioOutlined,
  CloseOutlined,
  PauseOutlined,
  SoundOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { authFetch, authHeaders } from './auth.js';

const SPEECH_THRESHOLD = 0.018;
const INTERRUPT_THRESHOLD = 0.03;
const SILENCE_AFTER_SPEECH_MS = 950;
const MIN_RECORDING_MS = 520;
const MAX_RECORDING_MS = 18_000;
const INTERRUPT_SUSTAIN_MS = 220;
const INTERRUPT_GAP_MS = 120;
const BACKCHANNEL_AFTER_MS = 2_600;
const BACKCHANNEL_COOLDOWN_MS = 5_200;
const BACKCHANNEL_MUTE_MS = 700;
const BACKCHANNEL_VOLUME = 0.32;
const BACKCHANNEL_PHRASES = ['Ага', 'Угу', 'Ммм'];

function rms(analyser) {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const sample of data) {
    const value = (sample - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / data.length);
}

function takeSpeechChunks(buffer, flush = false) {
  const chunks = [];
  let rest = buffer;
  while (rest.trim()) {
    const punctuation = rest.search(/[.!?…。！？](?:\s|$)/);
    if (punctuation >= 0) {
      const end = punctuation + 1;
      chunks.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trimStart();
      continue;
    }
    if (rest.length > 220) {
      const cut = rest.slice(0, 220).lastIndexOf(' ');
      if (cut > 40) {
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut + 1).trimStart();
        continue;
      }
    }
    break;
  }
  if (flush && rest.trim()) {
    chunks.push(rest.trim());
    rest = '';
  }
  return { chunks, rest };
}

function parseSse(buffer, onEvent) {
  const lines = buffer.split('\n');
  const remainder = lines.pop() || '';
  let type = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('data:') && type) {
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        onEvent(type, JSON.parse(raw));
      } catch {
        onEvent('error', { error: 'Некоректна подія голосового стріму' });
      }
      type = '';
    }
  }
  return remainder;
}

export default function VoiceMode({
  open,
  onClose,
  sessionId,
  reasoningEffort = 'none',
  onSessionChange,
  onExchange,
}) {
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('Натисни кнопку й говори');
  const [interim, setInterim] = useState('');
  const [turns, setTurns] = useState([]);
  const [handsFree, setHandsFree] = useState(true);
  const [backchannel, setBackchannel] = useState(true);
  const [speechRate, setSpeechRate] = useState(1);
  const [asrReady, setAsrReady] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [error, setError] = useState('');

  const phaseRef = useRef('idle');
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const monitorFrameRef = useRef(0);
  const speechStartedRef = useRef(false);
  const silenceSinceRef = useRef(0);
  const recordingStartedRef = useRef(0);
  const chatAbortRef = useRef(null);
  const ttsControllersRef = useRef(new Set());
  const audioQueueRef = useRef([]);
  const drainingRef = useRef(false);
  const currentAudioRef = useRef(null);
  const currentUrlRef = useRef(null);
  const sessionRef = useRef(sessionId || '');
  const mountedRef = useRef(true);
  const interruptSinceRef = useRef(0);
  const interruptQuietSinceRef = useRef(0);
  const speechSinceRef = useRef(0);
  const backchannelClipsRef = useRef([]);
  const backchannelLastRef = useRef(0);
  const backchannelMutedUntilRef = useRef(0);
  const backchannelAudioRef = useRef(null);

  useEffect(() => {
    sessionRef.current = sessionId || '';
  }, [sessionId]);

  const setVoicePhase = useCallback((next, nextStatus) => {
    phaseRef.current = next;
    if (mountedRef.current) {
      setPhase(next);
      if (nextStatus) setStatus(nextStatus);
    }
  }, []);

  const stopMonitor = useCallback(() => {
    if (monitorFrameRef.current) cancelAnimationFrame(monitorFrameRef.current);
    monitorFrameRef.current = 0;
  }, []);

  const stopAudio = useCallback(() => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    for (const controller of ttsControllersRef.current) controller.abort();
    ttsControllersRef.current.clear();
    audioQueueRef.current = [];
    const audio = currentAudioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.src = '';
      } catch {}
    }
    currentAudioRef.current = null;
    if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    currentUrlRef.current = null;
    drainingRef.current = false;
    interruptSinceRef.current = 0;
    interruptQuietSinceRef.current = 0;
  }, []);

  const closeMic = useCallback(() => {
    stopMonitor();
    try {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    } catch {}
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    try {
      audioContextRef.current?.close();
    } catch {}
    audioContextRef.current = null;
  }, [stopMonitor]);

  const playNext = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (audioQueueRef.current.length) {
        const item = audioQueueRef.current[0];
        let blob;
        try {
          blob = await item.ready;
        } catch {
          audioQueueRef.current.shift();
          continue;
        }
        if (!blob || phaseRef.current === 'listening') {
          audioQueueRef.current.shift();
          continue;
        }
        const url = URL.createObjectURL(blob);
        currentUrlRef.current = url;
        const audio = new Audio(url);
        audio.playbackRate = speechRate;
        currentAudioRef.current = audio;
        setVoicePhase('speaking', 'Відповідаю… (можна перебити)');
        await new Promise((resolve) => {
          audio.onended = resolve;
          audio.onerror = resolve;
          audio.play().catch(resolve);
        });
        try { audio.pause(); } catch {}
        URL.revokeObjectURL(url);
        if (currentUrlRef.current === url) currentUrlRef.current = null;
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        audioQueueRef.current.shift();
      }
    } finally {
      drainingRef.current = false;
      if (phaseRef.current === 'speaking') {
        setVoicePhase('idle', handsFree ? 'Слухаю далі' : 'Натисни кнопку й говори');
      }
    }
  }, [handsFree, setVoicePhase, speechRate]);

  const queueSpeech = useCallback((text) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean || !ttsReady) return;
    const controller = new AbortController();
    ttsControllersRef.current.add(controller);
    const ready = authFetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('TTS недоступний');
        return response.blob();
      })
      .finally(() => ttsControllersRef.current.delete(controller));
    audioQueueRef.current.push({ ready });
    void playNext();
  }, [playNext, ttsReady]);

  const playBackchannel = useCallback(() => {
    const clips = backchannelClipsRef.current;
    if (!clips.length) return;
    const now = performance.now();
    backchannelLastRef.current = now;
    backchannelMutedUntilRef.current = now + BACKCHANNEL_MUTE_MS;
    try { backchannelAudioRef.current?.pause(); } catch {}
    const audio = new Audio(clips[Math.floor(Math.random() * clips.length)]);
    audio.volume = BACKCHANNEL_VOLUME;
    backchannelAudioRef.current = audio;
    audio.play().catch(() => {});
  }, []);

  const monitorMicrophone = useCallback(() => {
    const level = rms(analyserRef.current);
    const now = performance.now();
    const current = phaseRef.current;
    if (current === 'listening') {
      // Поки грає підтакування, ігноруємо рівень: власний звук не має
      // ні рахуватись за мову, ні збивати відлік тиші.
      const muted = now < backchannelMutedUntilRef.current;
      if (!muted && level > SPEECH_THRESHOLD) {
        if (!speechStartedRef.current) speechSinceRef.current = now;
        speechStartedRef.current = true;
        silenceSinceRef.current = 0;
        setInterim('Слухаю…');
        if (
          backchannel &&
          now - speechSinceRef.current > BACKCHANNEL_AFTER_MS &&
          now - backchannelLastRef.current > BACKCHANNEL_COOLDOWN_MS
        ) {
          playBackchannel();
        }
      } else if (!muted && speechStartedRef.current) {
        if (!silenceSinceRef.current) silenceSinceRef.current = now;
        if (
          now - silenceSinceRef.current > SILENCE_AFTER_SPEECH_MS &&
          now - recordingStartedRef.current > MIN_RECORDING_MS
        ) {
          try { recorderRef.current?.stop(); } catch {}
          return;
        }
      }
      if (now - recordingStartedRef.current > MAX_RECORDING_MS) {
        try { recorderRef.current?.stop(); } catch {}
        return;
      }
    } else if (current === 'speaking') {
      // Перебивання тільки після сталого звуку: короткий стук або кашель
      // не має вбивати відповідь. Дірки коротші за INTERRUPT_GAP_MS
      // пробачаємо — між складами рівень теж просідає.
      if (level > INTERRUPT_THRESHOLD) {
        interruptQuietSinceRef.current = 0;
        if (!interruptSinceRef.current) interruptSinceRef.current = now;
        if (now - interruptSinceRef.current >= INTERRUPT_SUSTAIN_MS) {
          interruptSinceRef.current = 0;
          stopAudio();
          setInterim('');
          setVoicePhase('idle', 'Ти перебив — слухаю');
          setTimeout(() => {
            if (mountedRef.current && phaseRef.current === 'idle') startListening();
          }, 80);
          return;
        }
      } else if (interruptSinceRef.current) {
        if (!interruptQuietSinceRef.current) interruptQuietSinceRef.current = now;
        if (now - interruptQuietSinceRef.current > INTERRUPT_GAP_MS) {
          interruptSinceRef.current = 0;
          interruptQuietSinceRef.current = 0;
        }
      }
    }
    monitorFrameRef.current = requestAnimationFrame(monitorMicrophone);
  }, [backchannel, playBackchannel, setVoicePhase, stopAudio]);

  const ensureMicrophone = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    audioContextRef.current = context;
    analyserRef.current = analyser;
    return stream;
  }, []);

  const transcribe = useCallback(async (blob) => {
    setVoicePhase('transcribing', 'Розпізнаю українську…');
    const form = new FormData();
    form.append('audio', blob, 'voice.webm');
    const response = await authFetch('/api/asr', { method: 'POST', body: form });
    if (!response.ok) throw new Error('ASR недоступний');
    const payload = await response.json();
    const text = String(payload.text || '').trim();
    if (!text) throw new Error('Не почув фразу');
    return text;
  }, [setVoicePhase]);

  const askBot = useCallback(async (text) => {
    setVoicePhase('thinking', 'Думаю…');
    setError('');
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const headers = await authHeaders({ 'Content-Type': 'application/json' });
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message: text,
        stream: true,
        session_id: sessionRef.current,
        reasoning_effort: reasoningEffort,
      }),
    });
    if (!response.ok) throw new Error(`Чат HTTP ${response.status}`);
    if (!response.body) throw new Error('Сервер не відкрив голосовий стрім');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let speechBuffer = '';
    let reply = '';
    let emotion = 'idle';
    let newSessionId = sessionRef.current;
    const enqueueReadySpeech = (part) => {
      queueSpeech(part);
      setVoicePhase('speaking', 'Відповідаю… (можна перебити)');
    };
    const onEvent = (type, payload) => {
      if (type === 'delta') {
        const chunk = String(payload.chunk || '');
        reply += chunk;
        speechBuffer += chunk;
        const split = takeSpeechChunks(speechBuffer);
        speechBuffer = split.rest;
        split.chunks.forEach(enqueueReadySpeech);
      } else if (type === 'emotion') {
        emotion = payload.emotion || emotion;
      } else if (type === 'done') {
        reply = payload.reply || reply;
        emotion = payload.emotion || emotion;
        newSessionId = payload.session_id || newSessionId;
      } else if (type === 'error') {
        throw new Error(payload.error || 'Голосовий стрім завершився помилкою');
      }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSse(buffer, onEvent);
      }
      buffer += decoder.decode();
      parseSse(`${buffer}\n`, onEvent);
      const finalReply = String(reply || '').trim();
      const tail = takeSpeechChunks(speechBuffer, true);
      tail.chunks.forEach(enqueueReadySpeech);
      if (newSessionId && newSessionId !== sessionRef.current) {
        sessionRef.current = newSessionId;
        onSessionChange?.(newSessionId);
      }
      onExchange?.(text, finalReply, emotion);
      if (!tail.chunks.length && finalReply && !audioQueueRef.current.length) {
        enqueueReadySpeech(finalReply);
      }
      setTimeout(() => {
        if (mountedRef.current && phaseRef.current === 'thinking') {
          setVoicePhase('idle', handsFree ? 'Слухаю далі' : 'Натисни кнопку й говори');
        }
      }, 120);
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
    }
  }, [handsFree, onExchange, onSessionChange, queueSpeech, reasoningEffort, setVoicePhase]);

  const submitRecording = useCallback(async (blob) => {
    setInterim('');
    try {
      const text = await transcribe(blob);
      setTurns((previous) => [...previous, { role: 'user', text }]);
      await askBot(text);
    } catch (caught) {
      if (caught?.name === 'AbortError') return;
      const message = caught?.message || 'Не вдалося обробити голос';
      setError(message);
      setVoicePhase('idle', message);
    }
  }, [askBot, setVoicePhase, transcribe]);

  const startListening = useCallback(async () => {
    if (!open || phaseRef.current === 'listening' || phaseRef.current === 'transcribing') return;
    setError('');
    stopAudio();
    try {
      const stream = await ensureMicrophone();
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size) void submitRecording(blob);
      };
      recorderRef.current = recorder;
      speechStartedRef.current = false;
      silenceSinceRef.current = 0;
      speechSinceRef.current = 0;
      backchannelLastRef.current = 0;
      backchannelMutedUntilRef.current = 0;
      recordingStartedRef.current = performance.now();
      recorder.start(120);
      setVoicePhase('listening', 'Слухаю… говори природно');
      stopMonitor();
      monitorFrameRef.current = requestAnimationFrame(monitorMicrophone);
    } catch (caught) {
      setError(caught?.message || 'Немає доступу до мікрофона');
      setVoicePhase('idle', 'Дозволь доступ до мікрофона');
    }
  }, [ensureMicrophone, monitorMicrophone, open, setVoicePhase, stopAudio, stopMonitor, submitRecording]);

  const stopListening = useCallback(() => {
    stopMonitor();
    try { recorderRef.current?.stop(); } catch {}
  }, [stopMonitor]);

  const toggleVoice = useCallback(() => {
    if (phaseRef.current === 'listening') {
      stopListening();
    } else if (phaseRef.current === 'speaking') {
      stopAudio();
      setVoicePhase('idle', 'Зупинено');
    } else if (phaseRef.current === 'thinking' || phaseRef.current === 'transcribing') {
      chatAbortRef.current?.abort();
      setVoicePhase('idle', 'Зупинено');
    } else {
      void startListening();
    }
  }, [setVoicePhase, startListening, stopAudio, stopListening]);

  useEffect(() => {
    mountedRef.current = true;
    if (!open) return undefined;
    Promise.all([
      authFetch('/api/asr/status').then((response) => response.json()).then((payload) => setAsrReady(!!payload.enabled)).catch(() => setAsrReady(false)),
      authFetch('/api/tts/status').then((response) => response.json()).then((payload) => setTtsReady(!!payload.enabled)).catch(() => setTtsReady(false)),
    ]);
    return () => {
      mountedRef.current = false;
      stopAudio();
      closeMic();
      try { backchannelAudioRef.current?.pause(); } catch {}
      backchannelAudioRef.current = null;
      backchannelClipsRef.current.forEach((url) => URL.revokeObjectURL(url));
      backchannelClipsRef.current = [];
    };
  }, [closeMic, open, stopAudio]);

  useEffect(() => {
    if (!open || !ttsReady || !backchannel) return undefined;
    if (backchannelClipsRef.current.length) return undefined;
    let cancelled = false;
    (async () => {
      const clips = [];
      for (const phrase of BACKCHANNEL_PHRASES) {
        try {
          const response = await authFetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: phrase }),
          });
          if (!response.ok) continue;
          const blob = await response.blob();
          if (blob.size) clips.push(URL.createObjectURL(blob));
        } catch {}
      }
      if (cancelled || !mountedRef.current) {
        clips.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      backchannelClipsRef.current = clips;
    })();
    return () => { cancelled = true; };
  }, [backchannel, open, ttsReady]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault();
        toggleVoice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open, toggleVoice]);

  if (!open) return null;

  const phaseLabel = {
    idle: 'Готовий до розмови',
    listening: 'Слухаю тебе',
    transcribing: 'Перетворюю голос на текст',
    thinking: 'Міркую над відповіддю',
    speaking: 'Говорю — можеш перебити',
  }[phase] || status;

  return (
    <div className="voice-mode-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="voice-mode-shell" role="dialog" aria-modal="true" aria-label="Голосова розмова">
        <header className="voice-mode-header">
          <div>
            <div className="voice-mode-kicker">CLAUDE BOT · LIVE AUDIO</div>
            <h2>Голосова розмова</h2>
          </div>
          <Tooltip title="Закрити (Esc)">
            <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="Закрити голосовий режим" />
          </Tooltip>
        </header>

        <div className={`voice-orb voice-orb-${phase}`}>
          <span className="voice-orb-ring voice-orb-ring-one" />
          <span className="voice-orb-ring voice-orb-ring-two" />
          <button type="button" className="voice-orb-button" onClick={toggleVoice} aria-label={phase === 'idle' ? 'Почати слухати' : 'Зупинити голосовий режим'}>
            {phase === 'speaking' ? <SoundOutlined /> : phase === 'thinking' || phase === 'transcribing' ? <PauseOutlined /> : <AudioOutlined />}
          </button>
        </div>
        <div className="voice-mode-phase">{phaseLabel}</div>
        <div className="voice-mode-status">{status}</div>
        {!asrReady && <div className="voice-mode-warning">Локальний Whisper не знайдений — перевір `faster-whisper` і ffmpeg.</div>}
        {!ttsReady && <div className="voice-mode-warning">Piper TTS не знайдений — голос відповіді вимкнено.</div>}
        {error && <div className="voice-mode-error">{error}</div>}
        {interim && <div className="voice-mode-interim">{interim}</div>}

        <div className="voice-mode-conversation" aria-live="polite">
          {turns.length === 0 ? (
            <div className="voice-mode-empty">Говори українською — я розпізнаю фразу локально й відповім голосом.</div>
          ) : turns.slice(-6).map((turn, index) => (
            <div className={`voice-turn voice-turn-${turn.role}`} key={`${turn.role}-${index}-${turn.text.slice(0, 12)}`}>
              <span>{turn.role === 'user' ? 'Ти' : 'Клод Бот'}</span>
              <p>{turn.text}</p>
            </div>
          ))}
        </div>

        <footer className="voice-mode-footer">
          <div className="voice-mode-options">
            <label>
              <Switch size="small" checked={handsFree} onChange={setHandsFree} />
              <span>слухати після відповіді</span>
            </label>
            <label>
              <Switch size="small" checked={backchannel} onChange={setBackchannel} disabled={!ttsReady} />
              <span>підтакувати</span>
            </label>
            <label className="voice-rate-control">
              <span>швидкість</span>
              <Select
                size="small"
                value={speechRate}
                onChange={setSpeechRate}
                options={[1, 1.25, 1.5, 1.75, 2].map((value) => ({ value, label: `${value}×` }))}
              />
            </label>
          </div>
          <Button
            className={`voice-mode-main-button voice-mode-main-${phase}`}
            type="primary"
            icon={phase === 'idle' ? <AudioOutlined /> : <StopOutlined />}
            onClick={toggleVoice}
          >
            {phase === 'idle' ? 'Говорити' : phase === 'speaking' ? 'Перебити' : 'Зупинити'}
          </Button>
        </footer>
      </section>
    </div>
  );
}
