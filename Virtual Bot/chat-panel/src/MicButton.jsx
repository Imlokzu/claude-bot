import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { AudioOutlined, LoadingOutlined } from '@ant-design/icons';

/**
 * Мікрофон біля кнопки відправки: наговорив — текст зʼявився в полі.
 *
 * Два шляхи розпізнавання, у такому порядку:
 * 1) Whisper на бекенді (/api/asr) — краще з українською і працює офлайн;
 *    пишемо MediaRecorder'ом і відправляємо файл.
 * 2) Браузерний SpeechRecognition — якщо Whisper недоступний (нема моделі
 *    чи ffmpeg). Він онлайн і гірший з українською, тому саме запасний.
 */

const SR = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

export default function MicButton({ onText, disabled }) {
  const [whisper, setWhisper] = useState(false);
  const [state, setState] = useState('idle'); // idle | recording | working
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    fetch('/api/asr/status')
      .then((r) => r.json())
      .then((r) => setWhisper(!!r.enabled))
      .catch(() => setWhisper(false));
  }, []);

  /* Мікрофон і розпізнавач треба відпустити, навіть якщо панель закрили
     посеред запису — інакше індикатор запису висітиме у вкладці браузера. */
  useEffect(() => () => {
    try { recorderRef.current?.state === 'recording' && recorderRef.current.stop(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try { recognitionRef.current?.abort(); } catch {}
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startWhisper = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stopStream();
      setState('working');
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const form = new FormData();
        form.append('audio', blob, 'voice.webm');
        const res = await fetch('/api/asr', { method: 'POST', body: form });
        const data = await res.json();
        if (data.text) onText(data.text.trim());
      } catch {
        /* мовчки: не почули — користувач просто натисне ще раз */
      } finally {
        setState('idle');
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setState('recording');
  };

  const startBrowser = () => {
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'uk-UA';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((r) => r[0]?.transcript || '')
        .join(' ')
        .trim();
      if (text) onText(text);
    };
    recognition.onend = () => setState('idle');
    recognition.onerror = () => setState('idle');
    recognitionRef.current = recognition;
    recognition.start();
    setState('recording');
  };

  const toggle = async () => {
    if (state === 'working') return;
    if (state === 'recording') {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      else {
        try { recognitionRef.current?.stop(); } catch {}
        setState('idle');
      }
      return;
    }
    try {
      if (whisper && window.MediaRecorder && navigator.mediaDevices) await startWhisper();
      else startBrowser();
    } catch {
      stopStream();
      setState('idle');
    }
  };

  const unavailable = !SR && !whisper;
  const title = unavailable
    ? 'Розпізнавання недоступне'
    : state === 'recording'
    ? 'Зупинити запис'
    : state === 'working'
    ? 'Розпізнаю…'
    : whisper
    ? 'Сказати голосом (Whisper)'
    : 'Сказати голосом';

  return (
    <Tooltip title={title}>
      <Button
        type="text"
        className={`mic-button${state === 'recording' ? ' mic-button-recording' : ''}`}
        icon={state === 'working' ? <LoadingOutlined /> : <AudioOutlined />}
        onClick={toggle}
        disabled={disabled || unavailable}
      />
    </Tooltip>
  );
}
