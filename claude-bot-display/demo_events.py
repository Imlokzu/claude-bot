"""Automated demo: send a sequence of events to the running display."""

import asyncio
import json
import time

import websockets

URL = "ws://localhost:8001/ws/display"


async def send_event(ws, event_type, data):
    await ws.send(json.dumps({"type": event_type, "data": data}))
    print(f"Sent: {event_type}")


async def demo():
    async with websockets.connect(URL) as ws:
        # Start with happy face
        await send_event(ws, "emotion_change", {"emotion": "happy"})
        await asyncio.sleep(2)

        # Switch to listening
        await send_event(ws, "emotion_change", {"emotion": "listening"})
        await asyncio.sleep(2)

        # Surprised
        await send_event(ws, "emotion_change", {"emotion": "surprised"})
        await asyncio.sleep(2)

        # Voice dialog -> transcript screen
        await send_event(ws, "heard", {"text": "Клод, яка погода?"})
        await asyncio.sleep(2)
        await send_event(ws, "speaking", {"text": "Зараз +18, хмарно. Гарний день!"})
        await asyncio.sleep(3)

        # Custom recipe screen
        await send_event(
            ws,
            "show_custom",
            {
                "content_type": "list",
                "content": "1. Змішати яйця\n2. Додати борошно\n3. Посолити\n4. Смажити 2 хв",
                "duration_seconds": 6,
            },
        )
        await asyncio.sleep(7)

        # Timer
        await send_event(
            ws,
            "show_custom",
            {"content_type": "timer", "content": "15", "duration_seconds": 17},
        )
        await asyncio.sleep(10)

        # Back to face with thinking, then neutral
        await send_event(ws, "emotion_change", {"emotion": "thinking"})
        await asyncio.sleep(3)
        await send_event(ws, "emotion_change", {"emotion": "neutral"})


if __name__ == "__main__":
    print("Demo starting in 3 seconds...")
    time.sleep(3)
    asyncio.run(demo())
    print("Demo finished")
