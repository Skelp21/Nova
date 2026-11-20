//! VK audio through the API used by the Kate Mobile client.
use crate::accounts;
use crate::http::{client, err};
use crate::model::{RawStream, Track};
use serde_json::Value;

const API: &str = "https://api.vk.com/method";
const V: &str = "5.131";
pub const KATE_UA: &str =
    "KateMobileAndroid/56 lite-460 (Android 4.4.2; SDK 19; x86; unknown Android SDK built for x86; en)";
pub const KATE_CLIENT_ID: &str = "2685278";

pub fn oauth_url() -> String {
    format!(
        "https://oauth.vk.com/authorize?client_id={KATE_CLIENT_ID}&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=audio,offline&response_type=token&v={V}"
    )
}

fn token() -> Result<String, String> {
    accounts::get().vk_token.ok_or_else(|| "VK: войдите в аккаунт в настройках".to_string())
}

async fn call(method: &str, params: &[(&str, String)]) -> Result<Value, String> {
    let mut query: Vec<(&str, String)> = params.to_vec();
    query.push(("access_token", token()?));
    query.push(("v", V.to_string()));
    let res: Value = client()
        .get(format!("{API}/{method}"))
        .header("User-Agent", KATE_UA)
        .query(&query)
        .send()
        .await
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;
    if let Some(e) = res.get("error") {
        let msg = e.get("error_msg").and_then(|m| m.as_str()).unwrap_or("ошибка");
        return Err(format!("VK: {msg}"));
    }
    Ok(res.get("response").cloned().unwrap_or(Value::Null))
}

fn parse(v: &Value) -> Option<Track> {
    let owner = v.get("owner_id")?.as_i64()?;
    let id = v.get("id")?.as_i64()?;
    let key = v.get("access_key").and_then(|k| k.as_str()).unwrap_or("");
    let sid = if key.is_empty() { format!("{owner}_{id}") } else { format!("{owner}_{id}_{key}") };
    let mut t = Track::new("vk", sid);
    t.id = format!("vk:{owner}_{id}");
    t.title = v.get("title")?.as_str()?.to_string();
    t.artist = v.get("artist").and_then(|a| a.as_str()).unwrap_or("").to_string();
    t.duration = v.get("duration").and_then(|d| d.as_u64()).unwrap_or(0) as u32;
    t.album = v.pointer("/album/title").and_then(|a| a.as_str()).map(String::from);
    t.cover = v
        .pointer("/album/thumb/photo_600")
        .or_else(|| v.pointer("/album/thumb/photo_300"))
        .and_then(|c| c.as_str())
        .map(String::from);
    t.link = Some(format!("https://vk.com/audio{owner}_{id}"));
    t.unavailable = v.get("url").and_then(|u| u.as_str()).map_or(true, |u| u.is_empty());
    Some(t)
}

fn items(v: &Value) -> Vec<Track> {
    v.get("items").and_then(|i| i.as_array()).map(|a| a.iter().filter_map(parse).collect()).unwrap_or_default()
}

pub async fn search(query: &str, limit: usize) -> Result<Vec<Track>, String> {
    let res = call("audio.search", &[("q", query.to_string()), ("count", limit.to_string()), ("auto_complete", "1".into())]).await?;
    Ok(items(&res))
}

/// "Моя музыка" of the signed-in user.
pub async fn my_audio() -> Result<Vec<Track>, String> {
    let mut all = Vec::new();
    let mut offset = 0;
    loop {
        let res = call("audio.get", &[("count", "1000".into()), ("offset", offset.to_string())]).await?;
        let batch = items(&res);
        let n = batch.len();
        all.extend(batch);
        let total = res.get("count").and_then(|c| c.as_u64()).unwrap_or(0) as usize;
        offset += n;
        if n == 0 || offset >= total || offset >= 10_000 {
            break;
        }
    }
    Ok(all)
}

pub async fn stream(source_id: &str) -> Result<RawStream, String> {
    let res = call("audio.getById", &[("audios", source_id.to_string())]).await?;
    let url = res
        .as_array()
        .and_then(|a| a.first())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .filter(|u| !u.is_empty())
        .ok_or("VK: трек недоступен")?;
    Ok(RawStream { url: url.to_string(), hls: url.contains(".m3u8"), profile: "vk", ext: "mp3", headers: vec![] })
}

/// Extracts the token from the OAuth redirect (`blank.html#access_token=...`).
pub fn capture(url: &url::Url) -> Option<(String, String)> {
    if url.host_str() != Some("oauth.vk.com") || !url.path().starts_with("/blank.html") {
        return None;
    }
    let frag = url.fragment()?;
    let mut token = None;
    let mut user = String::new();
    for (k, v) in url::form_urlencoded::parse(frag.as_bytes()) {
        match k.as_ref() {
            "access_token" => token = Some(v.to_string()),
            "user_id" => user = v.to_string(),
            _ => {}
        }
    }
    token.map(|t| (t, user))
}
