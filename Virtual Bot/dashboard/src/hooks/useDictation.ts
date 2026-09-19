import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';

/*
 * Диктування: мікрофон → /api/asr → текст у поле вводу.
 *
 * Пороги й формат узяті з екрана (`static/screen/screen.js`) — там цей шлях
 * уже вилизаний живими записами, і вигадувати свої числа означало б
 * повторювати ту саму роботу гірше.
 *
 * Дві тонкощі, на яких це ламалось:
 *
 * 1. `recorder.stop()` переводить стан у `inactive` СИНХРОННО, а дані й
 *    подію `stop` кладе в чергу. Перевірка «якщо вже inactive — нічого не
 *    вийшло» спрацьовувала завжди, і диктування мовчки віддавало порожньо:
 *    кнопка є, тексту немає. Тому тепер усе завершення живе в `onstop`.
 * 2. Доріжки мікрофона глушимо ТАМ ЖЕ, після `onstop`, а не одразу за
 *    `stop()` — інакше останній шматок фрази не встигає дописатись.
 *
 * Контракт PromptBar: `onDictate()` повертає обіцянку з РОЗПІЗНАНИМ ТЕКСТОМ.
 * Фраза закінчується двома шляхами, і обидва ведуть до розпізнавання:
 * сама по тиші після мовлення — або повторним натиском на мікрофон
 * («договорив»), який приходить через `onDictateStop`.
 */

/** Жорстка стеля однієї фрази. */
const REC_MAX_MS = 15_000;
/** Стільки тиші ПІСЛЯ мовлення = фраза скінчилась. */
const SILENCE_MS = 1300;
/** Коротше — це не фраза, а стук. */
const MIN_REC_MS = 600;
/** Поріг «є голос». */
const VOL_SPEAK = 0.012;
/**
 * Довжина шматка для проміжного розпізнавання. 5000, а не 1200: на короткому
 * уривку Whisper домислює слова (заміряно на екрані — «Рэс-бери-пай-пай»
 * замість «Raspberry Pi»). Фраза коротша за 5 с живого тексту не покаже —
 * свідомий обмін: краще нічого, ніж вигадка.
 */
const PARTIAL_MS = 5000;
/** Скільки чекати першого звуку, перш ніж здатись. */
const NO_SPEECH_MS = 6000;

export function useDictation() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** Чорновий текст, поки фраза ще триває. */
  const [partial, setPartial] = useState('');
  /** Запис уже закрито, чекаємо на повну модель. */
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState('');
  const finishRef = useRef<(() => void) | null>(null);

  const listen = useCallback(async (): Promise<string | null> => {
    // Попередній запис міг ще не закритись (швидкий повторний натиск) —
    // закриваємо його, інакше два мікрофони писали б одночасно.
    finishRef.current?.();
    setError('');
    setPartial('');
    setRecognizing(false);

    let media: MediaStream;
    try {
      // Без власних обмежень: обробку браузера (придушення шуму, АРУ)
      // лишаємо ввімкненою — розпізнаванню вона допомагає, а сяйву вистачає
      // й обробленого сигналу. Так само робить екран.
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setError(
        (cause as Error)?.name === 'NotAllowedError'
          ? 'Доступ до мікрофона не дозволено'
          : 'Мікрофон недоступний',
      );
      return null;
    }
    if (!window.MediaRecorder) {
      media.getTracks().forEach((track) => track.stop());
      setError('Браузер не вміє записувати звук');
      return null;
    }
    setStream(media);

    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(media);
    } catch {
      media.getTracks().forEach((track) => track.stop());
      setStream(null);
      setError('Не вдалося почати запис');
      return null;
    }

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(media).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);

    let spoke = false;
    // Людина натиснула «стоп» сама. Тоді розпізнаємо навіть те, що не
    // дотягнуло до порогу гучності: вона свідомо просить текст, і мовчазна
    // відмова виглядала б як поламана кнопка.
    let forced = false;
    let partialBusy = false;
    let partialsOn = true;
    const startedAt = Date.now();
    let silenceSince = startedAt;
    let frame = 0;

    /* Чорновик, поки фраза ще триває. Помилку ковтаємо свідомо: це начерк,
       його рахує окрема швидка модель, і 503 лише вимикає чорновики. */
    const sendPartial = async (blob: Blob) => {
      partialBusy = true;
      try {
        const form = new FormData();
        form.append('audio', blob, 'voice.webm');
        const result = await api<{ text?: string }>('/api/asr/partial', {
          method: 'POST',
          body: form,
          raw: true,
        });
        if (result.text) setPartial(result.text);
      } catch (cause) {
        if ((cause as { status?: number })?.status === 503) partialsOn = false;
      } finally {
        partialBusy = false;
      }
    };

    recorder.ondataavailable = (event) => {
      if (!event.data || !event.data.size) return;
      chunks.push(event.data);
      // Перший шматок несе заголовки webm, тож декодується лише СКЛЕЄНЕ
      // аудіо з початку — шлемо накопичене, а не останній шматок окремо.
      if (partialsOn && spoke && !partialBusy && recorder.state === 'recording') {
        void sendPartial(new Blob(chunks, { type: 'audio/webm' }));
      }
    };

    const done = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        cancelAnimationFrame(frame);
        finishRef.current = null;
        media.getTracks().forEach((track) => track.stop());
        void audio.close();
        setStream(null);
        // Тишу на сервер не шлемо: платний запит заради порожнечі.
        const blob = new Blob(chunks, { type: 'audio/webm' });
        resolve((spoke || forced) && blob.size ? blob : null);
      };

      const finish = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
      finishRef.current = () => {
        forced = true;
        finish();
      };

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
        const level = Math.sqrt(sum / buffer.length);
        const now = Date.now();

        if (level > VOL_SPEAK) {
          spoke = true;
          silenceSince = now;
        }
        const longEnough = now - startedAt > MIN_REC_MS;
        const quietEnough = now - silenceSince > SILENCE_MS;
        if (
          (spoke && longEnough && quietEnough) ||
          now - startedAt > REC_MAX_MS ||
          (!spoke && now - startedAt > NO_SPEECH_MS)
        ) {
          return finish();
        }
        frame = requestAnimationFrame(tick);
      };

      recorder.start(PARTIAL_MS);
      frame = requestAnimationFrame(tick);
    });

    const blob = await done;
    if (!blob) return null;

    setRecognizing(true);
    const form = new FormData();
    form.append('audio', blob, 'voice.webm');
    try {
      const result = await api<{ text?: string }>('/api/asr', {
        method: 'POST',
        body: form,
        raw: true,
      });
      return (result.text ?? '').trim() || null;
    } catch (cause) {
      // Розпізнавання рахує хмара, локального відкату немає — про відмову
      // треба СКАЗАТИ, інакше зламана хмара виглядає як мовчазний мікрофон.
      setError((cause as Error).message || 'Не вдалося розпізнати');
      return null;
    } finally {
      setPartial('');
      setRecognizing(false);
    }
  }, []);

  /** Людина договорила: закриваємо фразу й віддаємо її на розпізнавання. */
  const finish = useCallback(() => finishRef.current?.(), []);

  return { listen, finish, stream, partial, recognizing, error };
}
