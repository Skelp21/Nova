pub mod lyrics;
pub mod soundcloud;
pub mod spotify;
pub mod vk;
pub mod yandex;
pub mod youtube;

use crate::model::{RawStream, Track};

pub async fn search(source: &str, query: &str, limit: usize) -> Result<Vec<Track>, String> {
    match source {
        "youtube" => youtube::search(query, limit).await,
        "soundcloud" => soundcloud::search(query, limit).await,
        "vk" => vk::search(query, limit).await,
        "yandex" => yandex::search(query, limit).await,
        other => Err(format!("Неизвестный источник: {other}")),
    }
}

pub async fn stream(track: &Track) -> Result<RawStream, String> {
    match track.source.as_str() {
        "youtube" => youtube::stream(&track.source_id).await,
        "soundcloud" => soundcloud::stream(&track.source_id).await,
        "vk" => vk::stream(&track.source_id).await,
        "yandex" => yandex::stream(&track.source_id).await,
        other => Err(format!("Неизвестный источник: {other}")),
    }
}

/// Radio continuation for any track: YouTube tracks seed directly, others are
/// first matched on YouTube Music by "artist title".
pub async fn radio(track: &Track) -> Result<Vec<Track>, String> {
    let seed = if track.source == "youtube" {
        track.source_id.clone()
    } else {
        let found = youtube::search(&format!("{} {}", track.artist, track.title), 1).await?;
        found.first().map(|t| t.source_id.clone()).ok_or("Не нашёл трек для волны")?
    };
    let mut list = youtube::radio(&seed).await?;
    list.retain(|t| t.source_id != seed);
    Ok(list)
}
