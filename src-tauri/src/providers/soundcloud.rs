//! SoundCloud through api-v2 with a client_id scraped from the public site.
use crate::http::{client, err};
use crate::model::{RawStream, Track};
use serde_json::Value;
use std::sync::Mutex;

const API: &str = "https://api-v2.soundcloud.com";

static CLIENT_ID: Mutex<Option<String>> = Mutex::new(None);

// Sync helpers so no lock guard ever lives across an `.await`.
fn cached_id() -> Option<String> {
    CLIENT_ID.lock().ok().and_then(|g| g.clone())
}

fn store_id(id: &str) {
    if let Ok(mut g) = CLIENT_ID.lock() {
        *g = Some(id.to_string());
    }
}

async fn client_id(force: bool) -> Result<String, String> {
    if !force {
        if let Some(id) = cached_id() {
            return Ok(id);
        }
    }
    let html = client().get("https://soundcloud.com/").send().await.map_err(err)?.text().await.map_err(err)?;
    let script_re = regex::Regex::new(r#"<script crossorigin src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)""#).unwrap();
    let id_re = regex::Regex::new(r#"client_id\s*[:=]\s*"([a-zA-Z0-9]{32})""#).unwrap();
    let scripts: Vec<String> = script_re.captures_iter(&html).map(|c| c[1].to_string()).collect();
    // The id usually lives in one of the last bundles.
    for src in scripts.iter().rev() {
        if let Ok(resp) = client().get(src).send().await {
            if let Ok(js) = resp.text().await {
                if let Some(c) = id_re.captures(&js) {
                    let id = c[1].to_string();
                    store_id(&id);
                    return Ok(id);
                }
            }
        }
    }
    Err("SoundCloud: не удалось получить client_id".into())
}

async fn get_json(path_and_query: &str) -> Result<Value, String> {
    for attempt in 0..2 {
        let id = client_id(attempt > 0).await?;
        let sep = if path_and_query.contains('?') { '&' } else { '?' };
        let resp = client()
            .get(format!("{API}{path_and_query}{sep}client_id={id}"))
            .send()
            .await
            .map_err(err)?;
        if resp.status() == 401 || resp.status() == 403 {
            continue; // client_id rotated — fetch a fresh one
        }
        return resp.error_for_status().map_err(err)?.json().await.map_err(err);
    }
    Err("SoundCloud: доступ запрещён".into())
}

fn parse_track(v: &Value) -> Option<Track> {
    let id = v.get("id")?.as_u64()?;
    let mut t = Track::new("soundcloud", id.to_string());
    t.title = v.get("title")?.as_str()?.to_string();
    t.artist = v
        .pointer("/publisher_metadata/artist")
        .and_then(|a| a.as_str())
        .filter(|a| !a.is_empty())
        .or_else(|| v.pointer("/user/username").and_then(|a| a.as_str()))
        .unwrap_or("")
        .to_string();
    t.duration = (v.get("full_duration").or(v.get("duration")).and_then(|d| d.as_u64()).unwrap_or(0) / 1000) as u32;
    t.cover = v
        .get("artwork_url")
        .and_then(|a| a.as_str())
        .or_else(|| v.pointer("/user/avatar_url").and_then(|a| a.as_str()))
        .map(|u| u.replace("-large.", "-t500x500."));
    t.link = v.get("permalink_url").and_then(|l| l.as_str()).map(String::from);
    t.unavailable = v.get("policy").and_then(|p| p.as_str()) == Some("SNIP");
    Some(t)
}

pub async fn search(query: &str, limit: usize) -> Result<Vec<Track>, String> {
    let res = get_json(&format!("/search/tracks?q={}&limit={limit}", urlencoding::encode(query))).await?;
    Ok(res
        .get("collection")
        .and_then(|c| c.as_array())
        .map(|a| a.iter().filter_map(parse_track).collect())
        .unwrap_or_default())
}

pub async fn stream(track_id: &str) -> Result<RawStream, String> {
    let track = get_json(&format!("/tracks/{track_id}")).await?;
    let auth = track.get("track_authorization").and_then(|a| a.as_str()).unwrap_or("");
    let codings = track
        .pointer("/media/transcodings")
        .and_then(|t| t.as_array())
        .ok_or("SoundCloud: нет потоков")?;
    let score = |c: &&Value| -> i32 {
        let proto = c.pointer("/format/protocol").and_then(|p| p.as_str()).unwrap_or("");
        let mime = c.pointer("/format/mime_type").and_then(|p| p.as_str()).unwrap_or("");
        let snipped = c.get("snipped").and_then(|s| s.as_bool()).unwrap_or(false);
        let mut s = 0;
        if proto == "progressive" { s += 10; }
        if mime.contains("mpeg") { s += 5; }
        if mime.contains("mp4") || mime.contains("aac") { s += 3; }
        if mime.contains("ogg") { s -= 3; } // hls.js can't play Ogg segments
        if snipped { s -= 100; }
        s
    };
    // Try every transcoding from best to worst: SoundCloud lists some that
    // no longer resolve (404) and some that are DRM-encrypted.
    let mut candidates: Vec<&Value> = codings
        .iter()
        .filter(|c| {
            let proto = c.pointer("/format/protocol").and_then(|p| p.as_str()).unwrap_or("");
            !proto.contains("encrypted")
        })
        .collect();
    candidates.sort_by_key(|c| -score(c));
    let mut last_err = String::from("SoundCloud: нет потоков");
    for c in candidates {
        let Some(base) = c.get("url").and_then(|u| u.as_str()) else { continue };
        let hls = c.pointer("/format/protocol").and_then(|p| p.as_str()) != Some("progressive");
        let mime = c.pointer("/format/mime_type").and_then(|p| p.as_str()).unwrap_or("");
        let path = base.strip_prefix(API).unwrap_or(base);
        match get_json(&format!("{path}?track_authorization={auth}")).await {
            Ok(resolved) => {
                if let Some(url) = resolved.get("url").and_then(|u| u.as_str()) {
                    let ext = if mime.contains("mpeg") { "mp3" } else if mime.contains("mp4") || mime.contains("aac") { "m4a" } else { "ogg" };
                    return Ok(RawStream { url: url.to_string(), hls, profile: "browser", ext });
                }
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}
