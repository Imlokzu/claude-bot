# ytm-helper

YouTube Music metadata for Claude Bot: search, albums, playlists, radio ("up
next"), lyrics, new releases and charts. Built on
[rustypipe](https://codeberg.org/ThetaDev/rustypipe) 0.11.4, keyless, no
account.

It only answers *what* to play. Audio goes through the bot's existing stream
proxy (`/api/music/stream`), because a YouTube Music track is an ordinary
YouTube video id.

```bash
cargo build --release          # target/release/ytm-helper (~5 MB, stripped)
./target/release/ytm-helper search "daft punk" --limit 5
./target/release/ytm-helper radio 4D7u5KF7SP8
./target/release/ytm-helper lyrics 4D7u5KF7SP8
./target/release/ytm-helper charts UA
```

Every command prints one JSON object; failures print `{"error": "..."}` and
exit with 1. `--storage DIR` caches client data between calls.

For a Raspberry Pi 3 (64-bit OS), cross-compile on a Mac instead of building
on the Pi: `cargo zigbuild --release --target aarch64-unknown-linux-gnu`.

License: GPL-3.0-or-later, because rustypipe is GPL-3.0. The helper is a
separate program; the backend talks to it over stdout only.
