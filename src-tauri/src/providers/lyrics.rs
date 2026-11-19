//! Lyrics (synced when available) from lrclib.net.
use crate::http::{client, err};
use crate::model::Lyrics;
use serde_json::Value;

fn clean_title(t: &str) -> String {
    // "Song (feat. X) [Remastered]" -> "Song"
    let re = regex::Regex::new(r"\s*[\(\[].*?[\)\]]").unwrap();
    re.replace_all(t, "").trim().to_string()
}

fn first_artist(a: &str) -> String {
    a.split([',', '&']).next().unwrap_or(a).trim().to_string()
}

fn to_lyrics(v: &Value) -> Lyrics {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| !x.trim().is_empty()).map(String::from);
    Lyrics { synced: s("syncedLyrics"), plain: s("plainLyrics") }
}

pub async fn find(title: &str, artist: &str, duration: u32) -> Result<Lyrics, String> {
    let ua = "Yarvi/0.1 (https://github.com/)";
    let title_c = clean_title(title);
    let artist_c = first_artist(artist);
    let dur = duration.to_string();
    let exact = client()
        .get("https://lrclib.net/api/get")
        .header("User-Agent", ua)
        .query(&[("track_name", title_c.as_str()), ("artist_name", artist_c.as_str()), ("duration", dur.as_str())])
        .send()
        .await
        .map_err(err)?;
    if exact.status().is_success() {
        let v: Value = exact.json().await.map_err(err)?;
        let l = to_lyrics(&v);
        if l.synced.is_some() || l.plain.is_some() {
            return Ok(l);
        }
    }
    let list: Value = client()
        .get("https://lrclib.net/api/search")
        .header("User-Agent", ua)
        .query(&[("q", format!("{artist_c} {title_c}"))])
        .send()
        .await
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;
    let arr = list.as_array().cloned().unwrap_or_default();
    // Prefer synced lyrics with a duration close to ours.
    let pick = arr
        .iter()
        .filter(|x| {
            let d = x.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0);
            duration == 0 || (d - duration as f64).abs() < 8.0
        })
        .max_by_key(|x| x.get("syncedLyrics").map_or(false, |s| s.is_string()) as u8)
        .or(arr.first());
    Ok(pick.map(to_lyrics).unwrap_or_default())
}
