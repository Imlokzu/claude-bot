//! ytm-helper — YouTube Music metadata for Claude Bot.
//!
//! One command per process, JSON on stdout, `{"error": "..."}` and exit code 1
//! on failure. The Python backend (`ytmusic.py`) calls it; audio itself still
//! goes through the backend's existing stream proxy, because a YTM track is an
//! ordinary YouTube video id.
//!
//! Output is our own compact schema rather than rustypipe's models: the
//! library's structs change between releases, and the screen app should not
//! break when the helper is rebuilt against a newer one.

use std::env;
use std::process::ExitCode;

use rustypipe::client::RustyPipe;
use rustypipe::model::{AlbumItem, ArtistId, Thumbnail, TrackItem};
use rustypipe::param::Country;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize)]
struct Track {
    id: String,
    title: String,
    artists: Vec<String>,
    album: Option<String>,
    album_id: Option<String>,
    duration: u32,
    cover: Option<String>,
    is_video: bool,
}

#[derive(Serialize)]
struct Album {
    id: String,
    title: String,
    artists: Vec<String>,
    year: Option<u16>,
    cover: Option<String>,
}

/// The smallest thumbnail at least `min` px wide: the screen is 320 px, and a
/// 544 px cover is wasted bandwidth on a Pi.
fn pick_cover(thumbs: &[Thumbnail], min: u32) -> Option<String> {
    let mut sorted: Vec<&Thumbnail> = thumbs.iter().collect();
    sorted.sort_by_key(|t| t.width);
    sorted
        .iter()
        .find(|t| t.width >= min)
        .or_else(|| sorted.last())
        .map(|t| t.url.clone())
}

fn artist_names(artists: &[ArtistId]) -> Vec<String> {
    artists.iter().map(|a| a.name.clone()).collect()
}

fn track(t: &TrackItem) -> Track {
    Track {
        id: t.id.clone(),
        title: t.name.clone(),
        artists: artist_names(&t.artists),
        album: t.album.as_ref().map(|a| a.name.clone()),
        album_id: t.album.as_ref().map(|a| a.id.clone()),
        duration: t.duration.unwrap_or(0),
        cover: pick_cover(&t.cover, 120),
        is_video: t.track_type.is_video(),
    }
}

fn album(a: &AlbumItem) -> Album {
    Album {
        id: a.id.clone(),
        title: a.name.clone(),
        artists: artist_names(&a.artists),
        year: a.year,
        cover: pick_cover(&a.cover, 120),
    }
}

fn country(code: &str) -> Option<Country> {
    serde_json::from_value(Value::String(code.to_ascii_uppercase())).ok()
}

fn usage() -> String {
    "usage: ytm-helper [--storage DIR] <search|albums|album|playlist|radio|lyrics|new|charts> [ARG] [--limit N]".into()
}

async fn run(args: Vec<String>) -> Result<Value, String> {
    let mut storage: Option<String> = None;
    let mut limit: usize = 20;
    let mut rest: Vec<String> = Vec::new();
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--storage" => storage = it.next(),
            "--limit" => limit = it.next().and_then(|v| v.parse().ok()).unwrap_or(limit).clamp(1, 100),
            _ => rest.push(arg),
        }
    }
    let cmd = rest.first().cloned().ok_or_else(usage)?;
    let arg = rest.get(1).cloned().unwrap_or_default();

    let mut builder = RustyPipe::builder();
    if let Some(dir) = storage {
        // Client versions and deobfuscation data are cached here, so a cold
        // start costs one extra request instead of one per call.
        builder = builder.storage_dir(dir);
    }
    let rp = builder.build().map_err(|e| e.to_string())?;
    let q = rp.query();
    let need = |what: &str| -> Result<(), String> {
        if arg.trim().is_empty() { Err(format!("{cmd}: missing {what}")) } else { Ok(()) }
    };

    match cmd.as_str() {
        "search" => {
            need("query")?;
            let res = q.music_search_tracks(&arg).await.map_err(|e| e.to_string())?;
            let tracks: Vec<Track> = res.items.items.iter().take(limit).map(track).collect();
            Ok(json!({ "tracks": tracks }))
        }
        "albums" => {
            need("query")?;
            let res = q.music_search_albums(&arg).await.map_err(|e| e.to_string())?;
            let albums: Vec<Album> = res.items.items.iter().take(limit).map(album).collect();
            Ok(json!({ "albums": albums }))
        }
        "album" => {
            need("album id")?;
            let a = q.music_album(&arg).await.map_err(|e| e.to_string())?;
            let tracks: Vec<Track> = a.tracks.iter().map(track).collect();
            Ok(json!({
                "id": a.id, "title": a.name, "artists": artist_names(&a.artists),
                "year": a.year, "cover": pick_cover(&a.cover, 200), "tracks": tracks,
            }))
        }
        "playlist" => {
            need("playlist id")?;
            let p = q.music_playlist(&arg).await.map_err(|e| e.to_string())?;
            let tracks: Vec<Track> = p.tracks.items.iter().take(limit).map(track).collect();
            Ok(json!({ "id": p.id, "title": p.name, "cover": pick_cover(&p.thumbnail, 200), "tracks": tracks }))
        }
        "radio" => {
            // "Up next" for a track: what YouTube Music would play after it.
            need("video id")?;
            let mut radio = q.music_radio_track(&arg).await.map_err(|e| e.to_string())?;
            if radio.items.len() < limit {
                let _ = radio.extend_limit(&q, limit).await;
            }
            let tracks: Vec<Track> = radio.items.iter().filter(|t| t.id != arg).take(limit).map(track).collect();
            Ok(json!({ "tracks": tracks }))
        }
        "lyrics" => {
            need("video id")?;
            let details = q.music_details(&arg).await.map_err(|e| e.to_string())?;
            let track_json = track(&details.track);
            match details.lyrics_id {
                Some(lid) => {
                    let lyrics = q.music_lyrics(&lid).await.map_err(|e| e.to_string())?;
                    Ok(json!({ "track": track_json, "lyrics": lyrics.body, "source": lyrics.footer }))
                }
                None => Ok(json!({ "track": track_json, "lyrics": Value::Null })),
            }
        }
        "new" => {
            let albums = q.music_new_albums().await.map_err(|e| e.to_string())?;
            let videos = q.music_new_videos().await.map_err(|e| e.to_string())?;
            let albums: Vec<Album> = albums.iter().take(limit).map(album).collect();
            let tracks: Vec<Track> = videos.iter().take(limit).map(track).collect();
            Ok(json!({ "albums": albums, "tracks": tracks }))
        }
        "charts" => {
            let c = if arg.is_empty() { None } else { country(&arg) };
            let charts = q.music_charts(c).await.map_err(|e| e.to_string())?;
            let mut tracks: Vec<Track> = charts.top_tracks.iter().take(limit).map(track).collect();
            // Chart track lists sometimes come back empty while the chart
            // playlist is fine; fall back to it rather than show nothing.
            if tracks.is_empty() {
                if let Some(pid) = charts.top_playlist_id.as_ref() {
                    if let Ok(p) = q.music_playlist(pid).await {
                        tracks = p.tracks.items.iter().take(limit).map(track).collect();
                    }
                }
            }
            let trending: Vec<Track> = charts.trending_tracks.iter().take(limit).map(track).collect();
            Ok(json!({ "tracks": tracks, "trending": trending }))
        }
        "version" => Ok(json!({ "helper": env!("CARGO_PKG_VERSION"), "rustypipe": "0.11.4" })),
        _ => Err(usage()),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match run(args).await {
        Ok(value) => {
            println!("{value}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            println!("{}", json!({ "error": message }));
            ExitCode::FAILURE
        }
    }
}
