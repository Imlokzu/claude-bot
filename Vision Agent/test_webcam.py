"""
Клод Бот — тест Vision Agent на вебці ноутбука.

Ганяє кадри з cv2.VideoCapture(0) через /vision/frame ендпоінт (main.py має
бути вже запущений: `uvicorn main:app --reload`) і малює результат наживо.
Жодного заліза (RPi/CSI-камера) для цього тесту не треба.

Запуск:
    python test_webcam.py

Вихід: клавіша 'q' у вікні перегляду.
"""

from __future__ import annotations

import cv2
import requests

SERVER_URL = "http://127.0.0.1:8000/vision/frame"
SEND_EVERY_N_FRAMES = 3  # не спамити сервер на кожному кадрі відеопотоку
REQUEST_TIMEOUT_S = 2


def main() -> None:
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError(
            "Не вдалося відкрити вебку (cv2.VideoCapture(0)). "
            "Перевірте, чи не зайнята камера іншим застосунком."
        )

    frame_count = 0
    last_result = {
        "faces_detected": 0,
        "face_boxes": [],
        "motion_detected": False,
        "motion_score": 0.0,
        "mode": "?",
    }

    print("Вебка відкрита. Натисніть 'q' у вікні перегляду, щоб вийти.")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("[!] Не вдалось прочитати кадр із вебки.")
                break

            frame_count += 1
            if frame_count % SEND_EVERY_N_FRAMES == 0:
                ok_encode, buf = cv2.imencode(".jpg", frame)
                if ok_encode:
                    try:
                        resp = requests.post(
                            SERVER_URL,
                            files={"file": ("frame.jpg", buf.tobytes(), "image/jpeg")},
                            timeout=REQUEST_TIMEOUT_S,
                        )
                        if resp.ok:
                            last_result = resp.json()
                        else:
                            print(f"[!] Сервер повернув {resp.status_code}: {resp.text}")
                    except requests.RequestException as e:
                        print(f"[!] Сервер недоступний ({SERVER_URL}): {e}")

            for x, y, w, h in last_result.get("face_boxes", []):
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

            status = (
                f"faces={last_result.get('faces_detected', 0)}  "
                f"motion={last_result.get('motion_detected', False)} "
                f"({last_result.get('motion_score', 0.0)})  "
                f"mode={last_result.get('mode', '?')}"
            )
            cv2.putText(
                frame, status, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2
            )

            cv2.imshow("Клод Бот — Vision Agent (тест на вебці)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
