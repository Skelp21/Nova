//! Reads public Spotify playlists/albums from the embed page (no login).
use crate::http::{client, err};
use crate::model::{ImportItem, ImportedPlaylist};
use serde_json::Value;

pub async fn import(link: &str) -> Result<ImportedPlaylist, String> {
    let re = regex::Regex::new(r"(playlist|album)[/:]([A-Za-z0-9]{22})").unwrap();
    let caps = re.captures(link).ok_or("Нужна ссылка на плейлист или альбом Spotify")?;
    let (kind, id) = (&caps[1], &caps[2]);
    let html = client()
        .get(format!("https://open.spotify.com/embed/{kind}/{id}"))
        .send()
        .await
        .map_err(err)?
        .text()
        .await
        .map_err(err)?;
    let data_re = regex::Regex::new(r#"(?s)<script id="__NEXT_DATA__" type="application/json">(.*?)</script>"#).unwrap();
    let raw = data_re.captures(&html).ok_or("Spotify: не удалось прочитать страницу")?;
    let data: Value = serde_json::from_str(&raw[1]).map_err(err)?;
    let entity = data
        .pointer("/props/pageProps/state/data/entity")
        .ok_or("Spotify: плейлист приватный или не найден")?;
    let name = entity
        .get("name")
        .or(entity.get("title"))
        .and_then(|n| n.as_str())
        .unwrap_or("Spotify")
        .to_string();
    let items = entity
        .get("trackList")
        .and_then(|t| t.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|t| {
                    Some(ImportItem {
                        title: t.get("title")?.as_str()?.to_string(),
                        artist: t.get("subtitle").and_then(|s| s.as_str()).unwrap_or("").replace('\u{a0}', " "),
                        duration: (t.get("duration").and_then(|d| d.as_u64()).unwrap_or(0) / 1000) as u32,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ImportedPlaylist { name, items })
}
