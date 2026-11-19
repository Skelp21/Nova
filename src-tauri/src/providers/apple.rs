//! Reads public Apple Music playlists and albums from the web page (no login).
//! The page embeds its data as JSON; we take every song (title + artist)
//! from it, with JSON-LD as a fallback.
use crate::http::{client, err};
use crate::model::{ImportItem, ImportedPlaylist};
use serde_json::Value;

fn iso_duration(s: &str) -> u32 {
    // "PT3M25S" -> 205
    let re = regex::Regex::new(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?").unwrap();
    re.captures(s)
        .map(|c| {
            let n = |i: usize| c.get(i).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
            n(1) * 3600 + n(2) * 60 + n(3)
        })
        .unwrap_or(0)
}

/// Walks the page JSON and collects song-like objects: they carry a title
/// and an artistName (the shape Apple uses for track list items).
fn collect_songs(v: &Value, out: &mut Vec<ImportItem>) {
    match v {
        Value::Object(map) => {
            let title = map.get("title").and_then(|t| t.as_str());
            let artist = map.get("artistName").and_then(|a| a.as_str());
            if let (Some(title), Some(artist)) = (title, artist) {
                let is_song = map
                    .get("contentDescriptor")
                    .and_then(|c| c.get("kind"))
                    .and_then(|k| k.as_str())
                    .map_or(true, |k| k.eq_ignore_ascii_case("song"));
                if is_song {
                    let ms = map.get("duration").and_then(|d| d.as_u64()).unwrap_or(0);
                    out.push(ImportItem { title: title.to_string(), artist: artist.to_string(), duration: (ms / 1000) as u32 });
                    return;
                }
            }
            map.values().for_each(|x| collect_songs(x, out));
        }
        Value::Array(a) => a.iter().for_each(|x| collect_songs(x, out)),
        _ => {}
    }
}

fn from_json_ld(html: &str) -> Option<ImportedPlaylist> {
    let re = regex::Regex::new(r#"(?s)<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>"#).unwrap();
    for c in re.captures_iter(html) {
        let Ok(v) = serde_json::from_str::<Value>(&c[1]) else { continue };
        let tracks = v.get("track").and_then(|t| t.as_array());
        let Some(tracks) = tracks else { continue };
        let artist_all = v
            .pointer("/byArtist/0/name")
            .or_else(|| v.pointer("/byArtist/name"))
            .and_then(|a| a.as_str())
            .unwrap_or("");
        let items: Vec<ImportItem> = tracks
            .iter()
            .filter_map(|t| {
                Some(ImportItem {
                    title: t.get("name")?.as_str()?.to_string(),
                    artist: t
                        .pointer("/byArtist/0/name")
                        .or_else(|| t.pointer("/byArtist/name"))
                        .and_then(|a| a.as_str())
                        .unwrap_or(artist_all)
                        .to_string(),
                    duration: t.get("duration").and_then(|d| d.as_str()).map(iso_duration).unwrap_or(0),
                })
            })
            .collect();
        if !items.is_empty() {
            let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("Apple Music").to_string();
            return Some(ImportedPlaylist { name, items });
        }
    }
    None
}

pub async fn import(link: &str) -> Result<ImportedPlaylist, String> {
    let url = link.trim();
    if !url.contains("music.apple.com/") {
        return Err("Нужна ссылка вида https://music.apple.com/…/playlist/… или …/album/…".into());
    }
    let html = client()
        .get(url)
        .header("Accept-Language", "ru,en;q=0.8")
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(|_| "Apple Music: страница не открылась — плейлист должен быть публичным".to_string())?
        .text()
        .await
        .map_err(err)?;

    let title_re = regex::Regex::new(r#"<meta property="og:title" content="([^"]+)""#).unwrap();
    let page_title = title_re
        .captures(&html)
        .map(|c| c[1].replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'"))
        .unwrap_or_else(|| "Apple Music".into());

    let data_re = regex::Regex::new(r#"(?s)<script[^>]+id="serialized-server-data"[^>]*>(.*?)</script>"#).unwrap();
    if let Some(c) = data_re.captures(&html) {
        if let Ok(v) = serde_json::from_str::<Value>(&c[1]) {
            let mut items = Vec::new();
            collect_songs(&v, &mut items);
            // The page also lists "more by artist" etc.: keep each song once.
            let mut seen = std::collections::HashSet::new();
            items.retain(|i| seen.insert(format!("{}|{}", i.artist.to_lowercase(), i.title.to_lowercase())));
            if !items.is_empty() {
                return Ok(ImportedPlaylist { name: page_title, items });
            }
        }
    }
    from_json_ld(&html).ok_or_else(|| "Apple Music: не нашёл треки на странице (плейлист пустой или закрытый)".into())
}
