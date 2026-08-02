"""CLI helper to send events to the backend WebSocket."""

from __future__ import annotations

import argparse
import asyncio
import json

import websockets

DEFAULT_URL = "ws://localhost:8001/ws/display"


async def send_event(event_type: str, data: dict, url: str) -> None:
    message = {"type": event_type, "data": data}
    async with websockets.connect(url) as ws:
        await ws.send(json.dumps(message))
        print(f"Sent: {message}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a test event to the backend")
    parser.add_argument("--type", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args()
    data = json.loads(args.data)
    asyncio.run(send_event(args.type, data, args.url))


if __name__ == "__main__":
    main()
