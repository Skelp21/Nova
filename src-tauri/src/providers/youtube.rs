//! YouTube Music via the InnerTube API (no key needed).
use crate::http::{client, err};
use crate::model::{parse_clock, RawStream, Track};
use serde_json::{json, Value};

const YTM: &str = "https://music.youtube.com/youtubei/v1";
const REMIX_VERSION: &str = "1.20241111.01.00";
/// "Songs" filter for music search.
const SONGS_PARAMS: &str = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";

pub const VR_UA: &str = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
pub const IOS_UA: &str = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

/// InnerTube clients that return plain stream URLs, tried in order.
struct Client {
    name: &'static str,
    id: &'static str,
    version: &'static str,
    ua: &'static str,
    profile: &'static str,
    extra: fn() -> Value,
}

fn vr_extra() -> Value {
    json!({ "deviceMake": "Oculus", "deviceModel": "Quest 3", "androidSdkVersion": 32, "osName": "Android", "osVersion": "12L" })
}

fn ios_extra() -> Value {
    json!({ "deviceMake": "Apple", "deviceModel": "iPhone16,2", "osName": "iPhone", "osVersion": "18.3.2.22D82" })
}

const CLIENTS: &[Client] = &[
    Client {
        name: "ANDROID_VR",
        id: "28",
        version: "1.60.19",
        ua: VR_UA,
        profile: "yt",
        extra: vr_extra,
    },
    Client {
        name: "IOS",
        id: "5",
        version: "20.10.4",
        ua: IOS_UA,
        profile: "yt_ios",
        extra: ios_extra,
    },
];

fn remix_ctx() -> Value {
    json!({ "client": { "clientName": "WEB_REMIX", "clientVersion": REMIX_VERSION, "hl": "ru", "gl": "RU" } })
}

async fn remix_post(endpoint: &str, mut body: Value) -> Result<Value, String> {
    body["context"] = remix_ctx();
    client()
        .post(format!("{YTM}/{endpoint}?prettyPrint=false"))
        .header("Origin", "https://music.youtube.com")
        .header("Referer", "https://music.youtube.com/")
        .json(&body)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?
        .json::<Value>()
        .await
        .map_err(err)
}

/// Collects every object stored under `key`, anywhere in the tree.
fn collect<'a>(v: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match v {
        Value::Object(map) => {
            for (k, val) in map {
                if k == key {
                    out.push(val);
                } else {
                    collect(val, key, out);
                }
            }
        }
        Value::Array(arr) => arr.iter().for_each(|x| collect(x, key, out)),
        _ => {}
    }
}

fn best_thumb(v: &Value) -> Option<String> {
    let mut found = Vec::new();
    collect(v, "thumbnails", &mut found);
    let url = found.first()?.as_array()?.last()?.get("url")?.as_str()?.to_string();
    // Ask for a bigger square cover than the list default.
    let re = regex::Regex::new(r"=w\d+-h\d+").ok()?;
    Some(re.replace(&url, "=w544-h544").to_string())
}

fn page_type(run: &Value) -> &str {
    run.pointer("/navigationEndpoint/browseEndpoint/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

fn parse_list_item(item: &Value) -> Option<Track> {
    let video_id = item
        .pointer("/playlistItemData/videoId")
        .or_else(|| item.pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId"))
        .and_then(|v| v.as_str())?;
    let cols = item.get("flexColumns")?.as_array()?;
    let runs_of = |i: usize| -> Vec<Value> {
        cols.get(i)
            .and_then(|c| c.pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default()
    };
    let title = runs_of(0).first()?.get("text")?.as_str()?.to_string();
    let meta = runs_of(1);
    let mut artists = Vec::new();
    let mut album = None;
    let mut duration = 0;
    for run in &meta {
        let text = run.get("text").and_then(|t| t.as_str()).unwrap_or("");
        match page_type(run) {
            "MUSIC_PAGE_TYPE_ARTIST" | "MUSIC_PAGE_TYPE_USER_CHANNEL" => artists.push(text.to_string()),
            "MUSIC_PAGE_TYPE_ALBUM" => album = Some(text.to_string()),
            _ => {
                if let Some(d) = parse_clock(text) {
                    duration = d;
                }
            }
        }
    }
    if artists.is_empty() {
        if let Some(first) = meta.first().and_then(|r| r.get("text")).and_then(|t| t.as_str()) {
            artists.push(first.to_string());
        }
    }
    if duration == 0 {
        // Some layouts keep the duration in a fixed column.
        let mut fixed = Vec::new();
        collect(item, "fixedColumns", &mut fixed);
        if let Some(t) = fixed
            .first()
            .and_then(|f| f.pointer("/0/musicResponsiveListItemFixedColumnRenderer/text/runs/0/text"))
            .and_then(|t| t.as_str())
        {
            duration = parse_clock(t).unwrap_or(0);
        }
    }
    let mut t = Track::new("youtube", video_id);
    t.title = title;
    t.artist = artists.join(", ");
    t.album = album;
    t.duration = duration;
    t.cover = best_thumb(item.get("thumbnail").unwrap_or(&Value::Null));
    t.link = Some(format!("https://music.youtube.com/watch?v={video_id}"));
    Some(t)
}

pub async fn search(query: &str, limit: usize) -> Result<Vec<Track>, String> {
    let res = remix_post("search", json!({ "query": query, "params": SONGS_PARAMS })).await?;
    let mut items = Vec::new();
    collect(&res, "musicResponsiveListItemRenderer", &mut items);
    Ok(items.into_iter().filter_map(parse_list_item).take(limit).collect())
}

/// Endless radio ("Моя волна") seeded by one video.
pub async fn radio(video_id: &str) -> Result<Vec<Track>, String> {
    let res = remix_post(
        "next",
        json!({ "videoId": video_id, "playlistId": format!("RDAMVM{video_id}"), "isAudioOnly": true }),
    )
    .await?;
    let mut items = Vec::new();
    collect(&res, "playlistPanelVideoRenderer", &mut items);
    Ok(items
        .into_iter()
        .filter_map(|it| {
            let id = it.get("videoId")?.as_str()?;
            let mut t = Track::new("youtube", id);
            t.title = it.pointer("/title/runs/0/text")?.as_str()?.to_string();
            t.artist = it
                .pointer("/longBylineText/runs/0/text")
                .or_else(|| it.pointer("/shortBylineText/runs/0/text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            t.duration = it
                .pointer("/lengthText/runs/0/text")
                .and_then(|v| v.as_str())
                .and_then(parse_clock)
                .unwrap_or(0);
            t.cover = best_thumb(it.get("thumbnail").unwrap_or(&Value::Null));
            t.link = Some(format!("https://music.youtube.com/watch?v={id}"));
            Some(t)
        })
        .collect())
}

/// Audio stream. On desktop yt-dlp goes first: it keeps up with YouTube's
/// anti-bot changes. InnerTube clients are the fallback (and the only way on
/// phones). Every URL is test-fetched before it is handed to the player,
/// because YouTube sometimes returns links that then answer 403.
pub async fn stream(video_id: &str) -> Result<RawStream, String> {
    let mut errors = Vec::new();
    #[cfg(desktop)]
    {
        match stream_ytdlp(video_id).await {
            Ok(s) => return Ok(s),
            Err(e) => errors.push(format!("yt-dlp: {e}")),
        }
    }
    for c in CLIENTS {
        match stream_innertube(video_id, c).await {
            Ok(s) => return Ok(s),
            Err(e) => errors.push(e),
        }
    }
    Err(format!("YouTube не отдал поток ({})", errors.join("; ")))
}

/// Fetches the first bytes of a stream to make sure it really plays.
async fn playable(url: &str, headers: &[(String, String)], ua: &str) -> bool {
    let mut rb = client().get(url).header("Range", "bytes=0-1023").header("User-Agent", ua);
    for (k, v) in headers.iter().filter(|(k, _)| !k.eq_ignore_ascii_case("user-agent")) {
        rb = rb.header(k.as_str(), v.as_str());
    }
    match rb.timeout(std::time::Duration::from_secs(8)).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

async fn stream_innertube(video_id: &str, c: &Client) -> Result<RawStream, String> {
    let mut client_ctx = (c.extra)();
    client_ctx["clientName"] = json!(c.name);
    client_ctx["clientVersion"] = json!(c.version);
    client_ctx["hl"] = json!("ru");
    client_ctx["gl"] = json!("RU");
    let body = json!({
        "videoId": video_id,
        "contentCheckOk": true,
        "racyCheckOk": true,
        "context": { "client": client_ctx }
    });
    let res: Value = client()
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("User-Agent", c.ua)
        .header("X-YouTube-Client-Name", c.id)
        .header("X-YouTube-Client-Version", c.version)
        .json(&body)
        .send()
        .await
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;
    let status = res.pointer("/playabilityStatus/status").and_then(|s| s.as_str()).unwrap_or("");
    if status != "OK" {
        let reason = res.pointer("/playabilityStatus/reason").and_then(|s| s.as_str()).unwrap_or(status);
        return Err(format!("{}: {reason}", c.name));
    }
    let formats = res
        .pointer("/streamingData/adaptiveFormats")
        .and_then(|f| f.as_array())
        .ok_or("нет потоков")?;
    let best = formats
        .iter()
        .filter(|f| f.get("mimeType").and_then(|m| m.as_str()).map_or(false, |m| m.starts_with("audio/")))
        .filter(|f| f.get("url").is_some())
        .max_by_key(|f| f.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0))
        .ok_or_else(|| format!("{}: нет аудиопотока", c.name))?;
    let mime = best.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
    let url = best["url"].as_str().unwrap_or_default().to_string();
    if !playable(&url, &[], c.ua).await {
        return Err(format!("{}: ссылка заблокирована", c.name));
    }
    Ok(RawStream {
        url,
        hls: false,
        profile: c.profile,
        ext: if mime.contains("mp4") { "m4a" } else { "webm" },
        headers: vec![],
    })
}

/// Folder for helper tools (yt-dlp). Set once at startup.
pub static TOOLS_DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

#[cfg(desktop)]
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

/// Finds yt-dlp: next to Yarvi.exe, in the tools folder, or in PATH.
/// Downloads the official build into the tools folder when missing.
#[cfg(desktop)]
async fn ytdlp_path() -> Result<std::path::PathBuf, String> {
    let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        let p = dir.join(name);
        if p.exists() {
            return Ok(p);
        }
    }
    let tools = TOOLS_DIR.get().cloned().ok_or("нет папки инструментов")?;
    let p = tools.join(name);
    if p.exists() {
        let old = std::fs::metadata(&p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map_or(false, |age| age > std::time::Duration::from_secs(3 * 24 * 3600));
        if old {
            let _ = update_ytdlp().await; // keep the old one if the update fails
        }
        return Ok(p);
    }
    // In PATH?
    let mut probe = tokio::process::Command::new(name);
    probe.arg("--version");
    #[cfg(windows)]
    {
        probe.creation_flags(0x0800_0000);
    }
    if probe.output().await.map(|o| o.status.success()).unwrap_or(false) {
        return Ok(std::path::PathBuf::from(name));
    }
    if !cfg!(windows) {
        return Err("yt-dlp не найден".into());
    }
    update_ytdlp().await?;
    Ok(p)
}

/// Downloads the latest official yt-dlp.exe into the tools folder.
#[cfg(desktop)]
async fn update_ytdlp() -> Result<(), String> {
    if !cfg!(windows) {
        return Err("обновление yt-dlp только для Windows".into());
    }
    let tools = TOOLS_DIR.get().cloned().ok_or("нет папки инструментов")?;
    let p = tools.join("yt-dlp.exe");
    tokio::fs::create_dir_all(&tools).await.map_err(err)?;
    let bytes = client()
        .get(YTDLP_URL)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?
        .bytes()
        .await
        .map_err(err)?;
    let tmp = tools.join("yt-dlp.download");
    tokio::fs::write(&tmp, &bytes).await.map_err(err)?;
    tokio::fs::rename(&tmp, &p).await.map_err(err)?;
    Ok(())
}

#[cfg(desktop)]
async fn stream_ytdlp(video_id: &str) -> Result<RawStream, String> {
    match ytdlp_once(video_id).await {
        Ok(s) => Ok(s),
        Err(first) => {
            // YouTube changed something: fetch the newest yt-dlp and retry once.
            if update_ytdlp().await.is_ok() {
                ytdlp_once(video_id).await
            } else {
                Err(first)
            }
        }
    }
}

#[cfg(desktop)]
async fn ytdlp_once(video_id: &str) -> Result<RawStream, String> {
    let exe = ytdlp_path().await?;
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args([
        "-f",
        "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "-j",
        "--no-warnings",
        "--no-playlist",
        &format!("https://music.youtube.com/watch?v={video_id}"),
    ]);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console flash.
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().await.map_err(|e| format!("yt-dlp: {e}"))?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        return Err(msg.lines().last().unwrap_or("ошибка").to_string());
    }
    let info: Value = serde_json::from_slice(&out.stdout).map_err(err)?;
    let url = info.get("url").and_then(|u| u.as_str()).ok_or("yt-dlp не вернул ссылку")?;
    let ext = match info.get("ext").and_then(|e| e.as_str()) {
        Some("m4a") | Some("mp4") => "m4a",
        _ => "webm",
    };
    // The URL only works with the headers yt-dlp used to get it.
    let headers: Vec<(String, String)> = info
        .get("http_headers")
        .and_then(|h| h.as_object())
        .map(|m| m.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
        .unwrap_or_default();
    let ua = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("user-agent"))
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| crate::http::BROWSER_UA.to_string());
    if !playable(url, &headers, &ua).await {
        return Err("ссылка от yt-dlp не открывается".into());
    }
    Ok(RawStream { url: url.to_string(), hls: false, profile: "browser", ext, headers })
}
