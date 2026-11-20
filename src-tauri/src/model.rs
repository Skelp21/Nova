use serde::{Deserialize, Serialize};

/// A track from any source. `id` is globally unique: "<source>:<sourceId>".
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub source: String,
    pub source_id: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: Option<String>,
    /// Seconds.
    #[serde(default)]
    pub duration: u32,
    #[serde(default)]
    pub cover: Option<String>,
    /// Public page of the track, for "open in browser".
    #[serde(default)]
    pub link: Option<String>,
    /// Marks preview-only or blocked tracks.
    #[serde(default)]
    pub unavailable: bool,
}

impl Track {
    pub fn new(source: &str, source_id: impl Into<String>) -> Self {
        let source_id = source_id.into();
        Track {
            id: format!("{source}:{source_id}"),
            source: source.to_string(),
            source_id,
            ..Default::default()
        }
    }
}

/// Where the frontend should load audio from. `url` already points at the
/// local proxy, so CORS and special headers are handled.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub url: String,
    /// "progressive" or "hls"
    pub kind: String,
}

/// Raw stream before proxying.
#[derive(Clone, Debug)]
pub struct RawStream {
    pub url: String,
    pub hls: bool,
    /// Header profile the proxy must use for the upstream request.
    pub profile: &'static str,
    pub ext: &'static str,
    /// Extra upstream headers (e.g. the ones yt-dlp says the URL needs).
    pub headers: Vec<(String, String)>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPlaylist {
    pub name: String,
    pub items: Vec<ImportItem>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub title: String,
    pub artist: String,
    pub duration: u32,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub synced: Option<String>,
    pub plain: Option<String>,
}

pub fn parse_clock(s: &str) -> Option<u32> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let mut total = 0u32;
    for p in parts {
        total = total * 60 + p.parse::<u32>().ok()?;
    }
    Some(total)
}
