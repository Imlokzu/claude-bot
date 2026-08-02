"""
Клод Бот — слухач USB-пульта (2.4G Composite Device receiver).

Читає натискання кнопок з усіх under-пристроїв пульта (event2 клавіатурна
частина, event4 Consumer Control — гучність/медіа, event5 System Control —
живлення) і:
  1. Друкує кожен код кнопки в консоль — щоб зібрати мапу кнопок пульта для
     майбутнього використання (яка кнопка = який keycode).
  2. Одразу мапить типові кнопки гучності/mute на amixer, щоб пультом можна
     було керувати звуком просто зараз.

Запуск: python3 remote_listener.py
Вихід: Ctrl+C
"""

from __future__ import annotations

import subprocess
import threading
import time

import evdev
from evdev import ecodes

# Резервні шляхи — використовуються лише якщо авто-детект не знайшов пульт.
# Нумерація eventN плаває між завантаженнями/системами, тому це запасний варіант.
DEVICE_PATHS = ["/dev/input/event2", "/dev/input/event4", "/dev/input/event5"]

# lsusb: 0627:697d Adomax Technology 2.4G Composite Device
REMOTE_VENDOR = 0x0627
REMOTE_PRODUCT = 0x697D

VOLUME_STEP = "5%"

# Скільки чекати перед повторним відкриттям пристрою після відʼєднання.
REOPEN_DELAY_S = 3.0


def find_device_paths() -> list[str]:
    """Авто-детект under-пристроїв пульта за vendor/product id.

    Нумерація /dev/input/eventN не стабільна, тому шукаємо всі event-пристрої
    з потрібними vendor/product. Якщо нічого не знайшли — повертаємо резервні
    хардкод-шляхи з попередженням."""
    found = []
    for path in evdev.list_devices():
        try:
            dev = evdev.InputDevice(path)
        except (FileNotFoundError, PermissionError, OSError) as e:  # noqa: PERF203
            print(f"[!] Не вдалося перевірити {path}: {e}")
            continue
        try:
            if dev.info.vendor == REMOTE_VENDOR and dev.info.product == REMOTE_PRODUCT:
                found.append(path)
        finally:
            dev.close()

    if found:
        print(f"Авто-детект знайшов пульт: {', '.join(sorted(found))}")
        return sorted(found)

    print(
        "[!] Авто-детект не знайшов пульт "
        f"({REMOTE_VENDOR:#06x}:{REMOTE_PRODUCT:#06x}) — "
        f"використовую резервні шляхи: {', '.join(DEVICE_PATHS)}"
    )
    return DEVICE_PATHS


def run_amixer(args: list[str]) -> None:
    try:
        subprocess.run(["amixer", "-c", "1", *args], check=False, capture_output=True)
    except Exception as e:  # noqa: BLE001
        print(f"[!] amixer помилка: {e}")


def handle_key(code_name: str) -> None:
    """Мапить відомі кнопки гучності/mute на реальні amixer-команди."""
    if code_name in ("KEY_VOLUMEUP",):
        run_amixer(["sset", "PCM", f"{VOLUME_STEP}+"])
        print("  -> гучність +5%")
    elif code_name in ("KEY_VOLUMEDOWN",):
        run_amixer(["sset", "PCM", f"{VOLUME_STEP}-"])
        print("  -> гучність -5%")
    elif code_name in ("KEY_MUTE",):
        run_amixer(["sset", "PCM", "toggle"])
        print("  -> mute перемкнуто")


def listen(path: str) -> None:
    """Читає події з пристрою у нескінченному циклі. Якщо пульт відʼєднали
    (read_loop падає з OSError), чекаємо кілька секунд і пробуємо перевідкрити
    пристрій замість того, щоб мовчки завершити потік."""
    while True:
        try:
            dev = evdev.InputDevice(path)
        except (FileNotFoundError, PermissionError, OSError) as e:
            print(f"[!] Не вдалося відкрити {path}: {e} — повтор через {REOPEN_DELAY_S:.0f}с")
            time.sleep(REOPEN_DELAY_S)
            continue

        print(f"Слухаю {path} ({dev.name})")
        try:
            for event in dev.read_loop():
                if event.type == ecodes.EV_KEY:
                    key_event = evdev.categorize(event)
                    if key_event.keystate == key_event.key_down:
                        code_name = key_event.keycode
                        print(f"[{path}] натиснуто: {code_name} (raw code={event.code})")
                        if isinstance(code_name, list):
                            for c in code_name:
                                handle_key(c)
                        else:
                            handle_key(code_name)
        except OSError as e:
            # Пристрій зник (пульт відʼєднали) — чекаємо і перевідкриваємо.
            print(f"[!] {path} відʼєднано ({e}) — повтор через {REOPEN_DELAY_S:.0f}с")
            time.sleep(REOPEN_DELAY_S)
        finally:
            try:
                dev.close()
            except Exception as e:  # noqa: BLE001
                print(f"[!] Помилка закриття {path}: {e}")


def main() -> None:
    threads = []
    for path in find_device_paths():
        t = threading.Thread(target=listen, args=(path,), daemon=True)
        t.start()
        threads.append(t)

    print("Пульт готовий — тисни кнопки (Ctrl+C для виходу)")
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\nВихід.")


if __name__ == "__main__":
    main()
