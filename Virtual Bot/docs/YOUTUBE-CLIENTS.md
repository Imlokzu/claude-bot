# Легкі неофіційні YouTube-клієнти і безкоштовний транскрайб (серпень 2026)

Відповідь на запит «знайди мега-легкий клієнт для YouTube, щось типу NewPipe,
тільки легеньке і на React, щоб включати ботові відео, і безкоштовний
транскрайб-апі, щоб бот про це відео «слухав»». Тут — що є, що обрано і як
користуватися вже готовими ендпоінтами бота з React-панелі.

---

## 1. Транскрайб (бот «слухає» відео) — ВИБРАНО ✅

**[youtube-transcript-api](https://pypi.org/project/youtube-transcript-api/)**
(Python, MIT, без ключа, без квот):

- працює з ручними й **автоматичними** субтитрами;
- пріоритет мов задається списком (`["uk","en",…]`);
- у 2026 залишається рекомендованим №1 у всіх оглядах «free youtube
  transcript api» — див. [порівняння підходів](https://outlierkit.com/resources/youtube-transcript-api/).

Уже працює в бота:

```
GET /api/music/transcript?id=<id|URL>&lang=uk        # сегменти [{start,text}]
GET /api/music/transcript?id=…&text=1                # склеєний текст (до 4000 знаків)
тул listen_to_video {url}                            # бот читає + вмикає звук на екрані
```

Фолбек: якщо YouTube закрив timedtext для IP — бекенд бере капшени через
Invidious (`/api/v1/captions/...`, WebVTT парситься своїм кодом у `music.py`).

## 2. Клієнт YouTube для React/JS — ВИБРАНО ✅ (два шари)

### 2.1. Пошук і метадані: yt-dlp на бекенді (те, що вже в бота)

**[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — неофіційний клієнт №1:
пошук (`ytsearch5:запит`), метадані, пряме аудіо. Не «легкий» в розумінні
бандла, але він на БЕКЕНДІ (Python), тож фронтенду дістається вже готовий
мікро-API:

```
GET /api/music/search?q=crab+rave&limit=5   → [{id,title,uploader,duration}]
GET /api/music/stream?provider=youtube&id=… → аудіо з Range (перемотка)
```

Це і є «NewPipe-подібний» клієнт для екрана/панелі — без жодного JS-SDK.

### 2.2. Чистий JS/React: youtubei.js — «NewPipe на TypeScript»

**[YouTube.js (npm: youtubei.js)](https://github.com/LuanRT/YouTube.js/)**
LuanRT — full-featured обгортка навколо приватного InnerTube API YouTube:
працює в Node.js, Deno і [сучасних браузерах](https://ytjs.dev/guide/getting-started),
без нативних залежностей. Це найближче до «легкого NewPipe на React»:

```js
import { Innertube } from "youtubei.js";
const yt = await Innertube.create();
const results = await yt.search("crab rave");
const info = await yt.getInfo(results.videos[0].id);
const audioUrl = info.streaming_data?.adaptive_formats
  .find(f => f.has_audio && !f.has_video)?.url;
```

Нюанси 2026 (важливо!):
- браузерний режим потребує проксі через СВІЙ бекенд для самих медіа-ссилок
  (CORS + PO-токен-гейт googlevideo з клієнтських IP);
- API неофіційний — ламається при змінах InnerTube, чиниться оновленням пакета.

**Коли обирати youtubei.js:** якщо хочеться пошуку/коментарів/чергів прямо в
React-панелі без Python. Для екрана бота цього не потрібно — там усе вже
через `/api/music/*`.

### 2.3. Invidious / Piped — REST без ключів (запасний канал)

- **Invidious API**: `/api/v1/search`, `/api/v1/videos/{id}`, стрім через
  `latest_version?id=…&itag=140&local=true` (інстанс проксіює крізь себе —
  обходить IP-гейт; саме цей шлях — головний у `music.py`).
- **Piped API**: `pipedapi.*/streams/{id}` повертає `audioStreams[]`.
- Мінус обох у 2026: **публічні інстанси флапають** (502↔206 в межах
  хвилини) і дедалі частіше закривають пошук капчею. Тому в бота їх
  кілька + ретраї + автодискаверері живих з `api.invidious.io`.
  Для продакшн-стабільності — свій інстанс у локальній мережі.

## 3. Порівняння (коротко)

| Варіант | Де крутиться | Ключі | Стабільність 2026 | Коли брати |
|---|---|---|---|---|
| yt-dlp (через наш `/api/music/*`) | бекенд Python | ні | висока (оновлюється сам) | екран бота, простий чат |
| youtubei.js | Node/браузер | ні | середня (InnerTube змінюється) | React-панелі з пошуком/чергами |
| Invidious/Piped API | сторонні інстанси | ні | флапає | фолбек, свій інстанс — норм |
| офіційний YouTube Data API | будь-де | так (квоти) | висока | тільки пошук-метадані, НЕ медіа |

Рекомендація для проєкту: **вже реалізований звʼязка yt-dlp (пошук) +
Invidious (стрім) + youtube-transcript-api (транскрайб)** на бекенді, а
React-клієнти (панель і майбутні застосунки) споживають її через
`/api/music/*`. Додатковий youtubei.js — тільки коли знадобиться те, чого
нема в цих ендпоінтах (коментарі, підписки, черги на боці клієнта).

## 4. Приклад: React-клієнт поверх наших ендпоінтів

```jsx
function useSearch(q) {
  const [tracks, setTracks] = useState([]);
  useEffect(() => {
    if (!q) return;
    fetch(`/api/music/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json()).then(d => setTracks(d.tracks))
      .catch(() => setTracks([]));
  }, [q]);
  return tracks;
}

// грати з перемоткою: <audio src="/api/music/stream?provider=youtube&id=ID" />
// позиція/перемотка — звичайні audio.currentTime + Range робить бекенд
```

Це і є «легкий клієнт на React»: нуль YouTube-SDK у бандлі, вся робота з
неофіційними API — на бекенді, де її можна ретраїти й кешувати.

## 5. Джерела

- [LuanRT/YouTube.js](https://github.com/LuanRT/YouTube.js/) і
  [ytjs.dev — Getting Started](https://ytjs.dev/guide/getting-started)
- [youtube-transcript-api на PyPI](https://pypi.org/project/youtube-transcript-api/)
- [огляд безкоштовних транскрайб-опцій 2026](https://outlierkit.com/resources/youtube-transcript-api/)
- [безключовий extraction-гайд](https://use-apify.com/blog/how-to-extract-youtube-transcripts-2026)
- наш код: `Virtual Bot/music.py`, `Virtual Bot/tools/music_tools.py`,
  `Virtual Bot/static/screen/screen.js` (Now Playing)
