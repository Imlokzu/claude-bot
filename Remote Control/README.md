# Remote Control — USB-пульт (2.4G Composite Device)

Слухач для бездротового USB-пульта/приймача (`lsusb`: `0627:697d Adomax
Technology 2.4G Composite Device`), підключеного до Raspberry Pi 3. Реєструється
в системі як три under-пристрої:

- `event2` — клавіатурна частина
- `event4` — Consumer Control (гучність, mute, медіа-кнопки)
- `event5` — System Control (живлення/сон)

## Що робить `remote_listener.py`

1. Друкує **кожне** натискання кнопки в консоль (`raw code=...`) — щоб
   зібрати мапу кнопок конкретного пульта для майбутнього використання
   (яка кнопка на пульті відповідає якому keycode).
2. Одразу мапить типові кнопки гучності (`KEY_VOLUMEUP`/`KEY_VOLUMEDOWN`/
   `KEY_MUTE`) на реальні `amixer`-команди — гучністю вже можна керувати
   пультом просто зараз.

## Встановлення й запуск на Pi

```bash
pip install evdev --break-system-packages   # або в venv Vision Agent
python3 remote_listener.py
```

Користувач має бути в групі `input` (перевірити: `groups`), інакше `/dev/input/eventN`
недоступні без sudo.

## Що далі

Кнопки, невідомі скрипту (все, крім гучності), поки лише друкуються в
консоль — зібравши коди реальних кнопок цього пульта, можна домапити їх
на інші дії (напр. talking/listening toggle для Voice Loop, навігація по
вкладках у Device Setup Wizard тощо).
