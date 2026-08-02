"""
Клод Бот — статус на 20-символьному I2C текстовому екрані (HD44780 + PCF8574
"backpack", типовий 16x2 або 20x4 LCD).

На RPi3 немає окремого чипа заряду батареї (живлення — просто повербанк
через micro-USB, без I2C fuel gauge), тому замість "% заряду" показуємо
реальний показник живлення: чи є зараз просадка напруги (undervoltage) —
vcgencmd get_throttled, той самий сигнал, що й у "жовтій блискавці" на
офіційному Raspberry Pi OS.

Показує по черзі (кожні 3с) кілька "сторінок" статусу:
  1. IP-адреса + температура CPU
  2. Живлення: OK / ПРОСІДАЄ (undervoltage зараз чи траплялось)
  3. Vision Agent: онлайн/офлайн (health-check на 127.0.0.1:8000)
  4. Мікрофон/динамік: чи є пристрої (аплай/арекорд)

Залежність: RPLCD (pip install RPLCD)
Запуск:     python3 status_display.py
"""

from __future__ import annotations

import re
import socket
import subprocess
import time

from RPLCD.i2c import CharLCD

# Типова адреса PCF8574 I2C-бекпаку — 0x27 або 0x3F, залежно від плати.
# Якщо екран мовчить, спробуй сканувати `sudo i2cdetect -y 1` і підстав
# знайдену адресу сюди.
I2C_ADDRESS = 0x27
COLS = 20
ROWS = 4

PAGE_INTERVAL_S = 3.0


def get_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError as e:
        print(f"[!] get_ip помилка: {e}")
        return "немає мережі"


def get_cpu_temp() -> str:
    try:
        out = subprocess.run(
            ["vcgencmd", "measure_temp"], capture_output=True, text=True, timeout=2
        ).stdout
        m = re.search(r"temp=([\d.]+)", out)
        return f"{float(m.group(1)):.0f}C" if m else "?"
    except Exception as e:  # noqa: BLE001
        print(f"[!] get_cpu_temp помилка: {e}")
        return "?"


def get_power_status() -> str:
    """Розбирає біти vcgencmd get_throttled — немає окремого fuel gauge на
    RPi3, тому це найближчий доступний показник стану живлення."""
    try:
        out = subprocess.run(
            ["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=2
        ).stdout
        m = re.search(r"0x([0-9a-fA-F]+)", out)
        if not m:
            return "?"
        bits = int(m.group(1), 16)
        under_now = bool(bits & 0x1)
        under_ever = bool(bits & 0x10000)
        if under_now:
            return "ПРОСІДАЄ ЗАРАЗ!"
        if under_ever:
            return "було падіння"
        return "живлення OK"
    except Exception as e:  # noqa: BLE001
        print(f"[!] get_power_status помилка: {e}")
        return "?"


def get_vision_agent_status() -> str:
    try:
        import urllib.request

        with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1) as r:
            return "онлайн" if r.status == 200 else f"код {r.status}"
    except Exception as e:  # noqa: BLE001
        print(f"[!] Vision Agent недоступний: {e}")
        return "офлайн"


def get_audio_status() -> str:
    # aplay/arecord можуть бути відсутні або зависнути — не даємо винятку
    # вбити цикл дисплея, повертаємо "?" за будь-якої проблеми.
    def probe(cmd: str) -> str | None:
        try:
            out = subprocess.run(
                [cmd, "-l"], capture_output=True, text=True, timeout=2
            ).stdout
            return "є" if "card" in out else "ні"
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as e:
            print(f"[!] {cmd} недоступний: {e}")
            return None

    spk = probe("aplay")
    mic = probe("arecord")
    return f"дин:{spk or '?'} мік:{mic or '?'}"


def pad(text: str, width: int = COLS) -> str:
    return text[:width].ljust(width)


def build_pages() -> list[list[str]]:
    ip = get_ip()
    temp = get_cpu_temp()
    power = get_power_status()
    vision = get_vision_agent_status()
    audio = get_audio_status()

    return [
        ["Клод Бот", f"IP: {ip}", f"CPU: {temp}", ""],
        ["Живлення", power, "", ""],
        ["Vision Agent", vision, "", ""],
        ["Аудіо", audio, "", ""],
    ]


def main() -> None:
    lcd = CharLCD(i2c_expander="PCF8574", address=I2C_ADDRESS, cols=COLS, rows=ROWS)
    print(f"LCD ініціалізовано на адресі {hex(I2C_ADDRESS)}, {COLS}x{ROWS}")

    try:
        while True:
            for page in build_pages():
                lcd.clear()
                for row_idx in range(ROWS):
                    lcd.cursor_pos = (row_idx, 0)
                    lcd.write_string(pad(page[row_idx] if row_idx < len(page) else ""))
                time.sleep(PAGE_INTERVAL_S)
    except KeyboardInterrupt:
        lcd.clear()
        print("\nВихід.")


if __name__ == "__main__":
    main()
