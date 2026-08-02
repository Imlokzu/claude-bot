"""
Клод Бот — Vision Agent (Крок 1: OpenCV Agent Setup)

Скелет бекенд-процесу "тіла" майбутнього агента. Ще без жодних сенсорів —
приймає кадр (з вебки ноута, пізніше — з CSI-камери на RPi) і повертає,
що на ньому: обличчя (Haar Cascade) та рух (frame differencing).

Запуск:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

Тест на вебці ноутбука:
    python test_webcam.py
"""

from __future__ import annotations

import os
import pathlib
import threading
import time

# Стеля пікселів для imdecode: стисла PNG/JPEG-бомба на кількасот КБ проходить
# будь-який байтовий ліміт (вона маленька саме в байтах), але розгортається в
# сотні МБ RAM ще всередині декодера (виміряно: 114КБ PNG 10000x10000 →
# +470МБ RSS). З цією стелею OpenCV відкидає такий кадр одразу після читання
# заголовка, ДО алокації пікселів (cv2.error → decode_frame поверне None → 400).
# Значення читається один раз при завантаженні бібліотеки, тому ставимо ДО
# import cv2 (перевірено: після import уже ігнорується). На imencode,
# VideoCapture і кадри з камери не впливає.
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", "8000000")

import cv2
import numpy as np
import yaml
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

CONFIG_PATH = pathlib.Path(__file__).parent / "config.yaml"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


config = load_config()


def _find_haarcascade_path() -> str:
    """
    pip-пакет opencv-python бандлить каскади в cv2.data.haarcascades, але
    системний Debian/apt-пакет python3-opencv цього модуля не має — там
    файли лежать окремим пакетом opencv-data у /usr/share/opencv4/.
    Пробуємо обидва варіанти, щоб main.py однаково працював і на macOS
    (venv, pip), і на Raspberry Pi (apt, system-site-packages venv).
    """
    filename = "haarcascade_frontalface_default.xml"
    if hasattr(cv2, "data"):
        return cv2.data.haarcascades + filename

    for candidate in (
        pathlib.Path("/usr/share/opencv4/haarcascades") / filename,
        pathlib.Path("/usr/share/opencv/haarcascades") / filename,
    ):
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(
        f"Не знайшов {filename} — установи пакет 'opencv-data' (apt) "
        "або перевір встановлення opencv-python (pip)."
    )


# Вбудований у OpenCV каскад — не треба нічого завантажувати окремо.
_face_cascade = cv2.CascadeClassifier(_find_haarcascade_path())
# CascadeClassifier мовчки повертає порожній класифікатор, якщо файл
# битий/не той — краще впасти одразу на старті, ніж "не бачити" облич.
if _face_cascade.empty():
    raise RuntimeError(
        "Haar-каскад завантажився порожнім — файл пошкоджений або несумісний. "
        "Перевстанови opencv-python (pip) або пакет 'opencv-data' (apt)."
    )

# Стан для детекції руху (порівнюємо з попереднім кадром).
# NB: global — це односесійний прототип; для кількох камер одночасно
# знадобиться тримати стан per-камера, а не в одній глобальній змінній.
_prev_gray: np.ndarray | None = None
# detect_motion() викликається і з async-ендпоінта (/vision/frame), і з
# sync-ендпоінтів у threadpool (snapshot, MJPEG-стрім) — read-modify-write
# _prev_gray без лока дає гонку між потоками.
_prev_gray_lock = threading.Lock()

app = FastAPI(title="Клод Бот — Vision Agent", version="0.1.0")

# Дозволяємо запити з Electron-рендерера (Claude Bot Studio, http://localhost:8443
# у dev або file:// у зібраному застосунку) — це локальний пристрій, не
# публічний сервіс, тож відкритий CORS тут не є проблемою.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class FrameResult(BaseModel):
    faces_detected: int
    face_boxes: list[list[int]]
    motion_detected: bool
    motion_score: float
    mode: str


def decode_frame(image_bytes: bytes) -> np.ndarray | None:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    # imdecode на порожньому буфері кидає cv2.error, а не повертає None.
    if arr.size == 0:
        return None
    try:
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except cv2.error:
        # Биті/зловмисні дані або кадр понад стелю OPENCV_IO_MAX_IMAGE_PIXELS —
        # для клієнта обидва випадки означають "не зміг декодувати" → 400.
        return None


def detect_faces(frame: np.ndarray) -> tuple[np.ndarray, list[list[int]]]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    min_w, min_h = config["vision"].get("min_face_size", [40, 40])

    # Haar Cascade — O(пікселі): на RPi3 при 640x480 detectMultiScale сам по
    # собі займав 140-200мс (виміряно), тоді як cv2.VideoCapture.read() —
    # лише 2-40мс. Тому детектуємо на зменшеній копії (ширина як у
    # capture_resolution "за замовчуванням", ~320px) і масштабуємо
    # координати назад — на повнорозмірному кадрі це вчетверо швидше, а
    # якість самого кадру (для показу) лишається незмінною.
    detect_width = config["vision"].get("detect_width", 320)
    h, w = gray.shape[:2]
    scale = detect_width / w if w > detect_width else 1.0

    # max(1, ...): на виродженому, але валідному кадрі (напр. 10000x1) масштаб
    # дає int(h * scale) == 0, а cv2.resize на нульовий розмір кидає
    # cv2.error → був 500 замість нормальної відповіді "0 облич".
    small_w, small_h = max(1, int(w * scale)), max(1, int(h * scale))
    small = cv2.resize(gray, (small_w, small_h)) if scale != 1.0 else gray

    # minSize НЕ масштабуємо разом із кадром: менший minSize змушує
    # detectMultiScale сканувати набагато більше віконних масштабів, що
    # компенсує (і навіть переважає) виграш від меншого зображення.
    faces = _face_cascade.detectMultiScale(
        small, scaleFactor=1.1, minNeighbors=5, minSize=(min_w, min_h)
    )
    boxes = [
        [int(x / scale), int(y / scale), int(w_ / scale), int(h_ / scale)]
        for (x, y, w_, h_) in faces
    ]
    return gray, boxes


def detect_motion(gray: np.ndarray) -> tuple[bool, float]:
    global _prev_gray
    blurred = cv2.GaussianBlur(gray, (21, 21), 0)

    # Увесь read-modify-write під локом — сюди заходять одночасно і event
    # loop (/vision/frame), і потоки з threadpool (snapshot, стрім).
    with _prev_gray_lock:
        if _prev_gray is None or _prev_gray.shape != blurred.shape:
            _prev_gray = blurred
            return False, 0.0

        frame_delta = cv2.absdiff(_prev_gray, blurred)
        _prev_gray = blurred

    thresh = cv2.threshold(frame_delta, 25, 255, cv2.THRESH_BINARY)[1]
    thresh = cv2.dilate(thresh, None, iterations=2)

    changed_pixels = cv2.countNonZero(thresh)
    total_pixels = thresh.shape[0] * thresh.shape[1]
    score = changed_pixels / total_pixels if total_pixels else 0.0

    min_ratio = config["vision"].get("motion_min_area_ratio", 0.01)
    return score > min_ratio, round(score, 4)


class VisionSettings(BaseModel):
    motion_min_area_ratio: float
    min_face_size: list[int]
    mode: str


class VisionSettingsUpdate(BaseModel):
    motion_min_area_ratio: float | None = None
    min_face_size: list[int] | None = None


@app.get("/health")
def health():
    return {"status": "ok", "mode": config["vision"]["mode"]}


@app.get("/vision/settings", response_model=VisionSettings)
def get_settings():
    return VisionSettings(
        motion_min_area_ratio=config["vision"].get("motion_min_area_ratio", 0.01),
        min_face_size=config["vision"].get("min_face_size", [40, 40]),
        mode=config["vision"]["mode"],
    )


@app.post("/vision/settings", response_model=VisionSettings)
def update_settings(update: VisionSettingsUpdate):
    """
    Змінює поріг детекції руху / мінімальний розмір обличчя в пам'яті процесу
    (не пише назад у config.yaml) — для живого підлаштування чутливості з
    вкладки "Зір" у Claude Bot Studio, без перезапуску сервера.
    """
    if update.motion_min_area_ratio is not None:
        config["vision"]["motion_min_area_ratio"] = update.motion_min_area_ratio
    if update.min_face_size is not None:
        config["vision"]["min_face_size"] = update.min_face_size

    return VisionSettings(
        motion_min_area_ratio=config["vision"].get("motion_min_area_ratio", 0.01),
        min_face_size=config["vision"].get("min_face_size", [40, 40]),
        mode=config["vision"]["mode"],
    )


# Ліміт на РОЗМІР У БАЙТАХ завантаженого кадру. Це захист від великих тіл,
# а не від бомб-розпаковок: стисла бомба маленька в байтах і проходить цей
# ліміт — її ріже стеля пікселів OPENCV_IO_MAX_IMAGE_PIXELS (див. імпорти).
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024


@app.post("/vision/frame", response_model=FrameResult)
async def process_frame(file: UploadFile = File(...)):
    # Starlette на цей момент уже прийняв тіло (велике — у спул-файл на
    # диску): перевіряємо відомий розмір ДО read(), щоб не тягнути
    # багатогігабайтний спул у RAM лише заради перевірки довжини.
    if file.size is not None and file.size > _MAX_UPLOAD_BYTES:
        return JSONResponse(
            status_code=400,
            content={"error": "зображення завелике (макс. 5 МБ)"},
        )

    image_bytes = await file.read()

    # Запасна перевірка тим самим лімітом — якщо size невідомий (None).
    if len(image_bytes) > _MAX_UPLOAD_BYTES:
        return JSONResponse(
            status_code=400,
            content={"error": "зображення завелике (макс. 5 МБ)"},
        )

    frame = decode_frame(image_bytes)

    if frame is None:
        return JSONResponse(status_code=400, content={"error": "could not decode image"})

    # Захист від завеликих кадрів — Haar + blur на десятках мегапікселів
    # надовго займуть CPU (і пам'ять) одним-єдиним запитом. Основну роботу
    # робить стеля пікселів у декодері (див. імпорти) — це запасний рубіж
    # на випадок збірки OpenCV, яка ігнорує OPENCV_IO_MAX_IMAGE_PIXELS.
    h, w = frame.shape[:2]
    if h * w > 8_000_000:
        return JSONResponse(
            status_code=400,
            content={"error": f"кадр завеликий ({w}x{h}), максимум ~8 мегапікселів"},
        )

    gray, face_boxes = detect_faces(frame)
    motion_detected, motion_score = detect_motion(gray)

    return FrameResult(
        faces_detected=len(face_boxes),
        face_boxes=face_boxes,
        motion_detected=motion_detected,
        motion_score=motion_score,
        mode=config["vision"]["mode"],
    )


# Тримаємо камеру відкритою між запитами — відкриття cv2.VideoCapture
# щоразу наново (як було раніше) займає ~1-2с на USB-вебці, тому кадр у
# <img>, що б'є в /vision/snapshot.jpg на кожен polling-тік, візуально не
# встигав оновлюватись. Один спільний cap + лок під потоки (генератор
# стріму виконується в threadpool Starlette, а не в event loop).
_capture: cv2.VideoCapture | None = None
_capture_lock = threading.Lock()


def _get_capture() -> cv2.VideoCapture | None:
    global _capture
    device_index = config["vision"].get("camera_index", 0)
    if _capture is None or not _capture.isOpened():
        _capture = cv2.VideoCapture(device_index)
        if not _capture.isOpened():
            # Не лишаємо "мертвий" закритий об'єкт у глобалі — release +
            # None, щоб наступний виклик спробував відкрити камеру наново.
            _capture.release()
            _capture = None
            return None
        else:
            # Сира роздільність YUYV (640x480+) по слабкому USB (RPi3 + хаб з
            # Ethernet-адаптером на тій самій шині) читалась 1-1.5с/кадр —
            # забагато для живого перегляду. Але ця ж вебка вміє й апаратний
            # MJPG (стиснення просто в камері, менше даних по USB) — на ньому
            # навіть 640x480 читається за ~40мс, як і 320x240 у сирому режимі.
            _capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            width, height = config["vision"].get("capture_resolution", [640, 480])
            _capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            _capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return _capture if _capture.isOpened() else None


def capture_frame() -> tuple[np.ndarray | None, str | None]:
    """Захоплює один кадр з відкритої (спільної) камери. Повертає
    (frame, None) або (None, error_message)."""
    device_index = config["vision"].get("camera_index", 0)
    with _capture_lock:
        cap = _get_capture()
        if cap is None:
            return None, f"не вдалося відкрити камеру (index={device_index})"

        ok, frame = cap.read()
        if not ok or frame is None:
            return None, "не вдалося прочитати кадр"
        return frame, None


@app.on_event("shutdown")
def _release_camera() -> None:
    global _capture
    with _capture_lock:
        if _capture is not None:
            _capture.release()
            _capture = None


@app.get("/vision/snapshot", response_model=FrameResult)
def snapshot():
    """
    Захоплює кадр і повертає лише JSON-результат детекції (без самого
    зображення) — щоб зовнішній агент (напр. OpenClaw tool-плагін) міг
    просто зробити GET-запит "що ти зараз бачиш?", не піклуючись про
    захоплення й кодування кадру самостійно.

    NB: звичайний `def`, не `async def` — capture_frame() блокує (I/O з
    камери), а FastAPI сам виносить sync-ендпоінти в threadpool. Якби це
    було `async def`, читання кадру ставало б увесь event loop, і всі
    паралельні запити (кілька глядачів, Electron + браузер) серіалізувались
    би одне за одним, а не оброблялись конкурентно.
    """
    frame, error = capture_frame()
    if frame is None:
        return JSONResponse(status_code=503, content={"error": error})

    gray, face_boxes = detect_faces(frame)
    motion_detected, motion_score = detect_motion(gray)

    return FrameResult(
        faces_detected=len(face_boxes),
        face_boxes=face_boxes,
        motion_detected=motion_detected,
        motion_score=motion_score,
        mode=config["vision"]["mode"],
    )


@app.get("/vision/snapshot.jpg")
def snapshot_jpg():
    """
    Те саме, що /vision/snapshot, але повертає сам кадр як JPEG (з
    намальованими зеленими рамками навколо знайдених облич) — для живого
    перегляду камери у вкладці "Зір" Claude Bot Studio (<img src=...>).

    NB: sync `def`, не `async def` — та сама причина, що й у /vision/snapshot.
    """
    frame, error = capture_frame()
    if frame is None:
        return JSONResponse(status_code=503, content={"error": error})

    _gray, face_boxes = detect_faces(frame)
    for x, y, w, h in face_boxes:
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return JSONResponse(status_code=500, content={"error": "не вдалося закодувати JPEG"})

    return Response(content=buf.tobytes(), media_type="image/jpeg")


def _mjpeg_generator(fps: float = 15.0):
    """Безперервний генератор multipart/x-mixed-replace кадрів — саме те,
    що <img src="/vision/stream.mjpg"> вміє відтворювати нативно як живе
    відео, без ручного polling з боку React."""
    frame_interval = 1.0 / fps
    # Якщо камера постійно не віддає кадри, цикл без yield ніколи не отримає
    # GeneratorExit від відключеного клієнта і крутитиметься вічно — після
    # ~30 невдач поспіль (2с при 15 fps) закриваємо стрім, клієнт перепідключиться.
    consecutive_failures = 0
    while True:
        started = time.monotonic()
        frame, error = capture_frame()
        if frame is None:
            consecutive_failures += 1
            if consecutive_failures >= 30:
                return
        else:
            consecutive_failures = 0
            _gray, face_boxes = detect_faces(frame)
            for x, y, w, h in face_boxes:
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ok:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
                )

        elapsed = time.monotonic() - started
        time.sleep(max(0.0, frame_interval - elapsed))


@app.get("/vision/stream.mjpg")
def stream_mjpg():
    """
    Справжній живий відеопотік (MJPEG, multipart/x-mixed-replace) для
    <img src="..."> у вкладці "Зір" — на відміну від /vision/snapshot.jpg
    (один кадр на запит + ручний polling з UI), тут браузер сам постійно
    отримує нові кадри в межах одного відкритого з'єднання.
    """
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config["server"]["host"],
        port=config["server"]["port"],
        reload=True,
    )
