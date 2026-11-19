//! Local HTTP proxy on 127.0.0.1 for audio.
//! - adds CORS so Web Audio (equalizer) can process remote streams;
//! - sends the upstream headers each source needs (e.g. YouTube UA);
//! - rewrites HLS playlists so segments and keys also go through it;
//! - serves downloaded files with Range support for offline playback.
//! Every URL carries a random key so other local programs/pages can't use it.
use crate::http::{client, BROWSER_UA};
use crate::model::{RawStream, StreamInfo};
use crate::providers::{vk::KATE_UA, youtube::{IOS_UA, VR_UA}};
use axum::{
    body::Body,
    extract::Query,
    http::{header, HeaderMap, Response, StatusCode},
    routing::get,
    Router,
};
use rand::{distributions::Alphanumeric, Rng};
use serde::Deserialize;
use std::io::SeekFrom;
use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

static PORT: OnceLock<u16> = OnceLock::new();
static KEY: OnceLock<String> = OnceLock::new();

#[derive(Deserialize)]
struct RemoteQ {
    u: String,
    #[serde(default)]
    c: Option<String>,
    k: String,
}

#[derive(Deserialize)]
struct FileQ {
    path: String,
    k: String,
}

pub fn start() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let _ = PORT.set(port);
    let _ = KEY.set(rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect());
    let app = Router::new().route("/p", get(remote)).route("/hls", get(hls)).route("/f", get(file));
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => {
                let _ = axum::serve(l, app).await;
            }
            Err(e) => eprintln!("proxy: {e}"),
        }
    });
    Ok(port)
}

fn key() -> &'static str {
    KEY.get().map(|s| s.as_str()).unwrap_or("")
}

fn base() -> String {
    format!("http://127.0.0.1:{}", PORT.get().copied().unwrap_or(0))
}

fn remote_url(route: &str, url: &str, profile: &str) -> String {
    format!("{}/{route}?k={}&c={profile}&u={}", base(), key(), urlencoding::encode(url))
}

pub fn proxied(raw: &RawStream) -> StreamInfo {
    StreamInfo {
        url: remote_url(if raw.hls { "hls" } else { "p" }, &raw.url, raw.profile),
        kind: if raw.hls { "hls" } else { "progressive" }.into(),
    }
}

pub fn local_file(path: &str) -> StreamInfo {
    StreamInfo {
        url: format!("{}/f?k={}&path={}", base(), key(), urlencoding::encode(path)),
        kind: "progressive".into(),
    }
}

pub fn apply_profile(rb: reqwest::RequestBuilder, profile: &str) -> reqwest::RequestBuilder {
    match profile {
        "yt" => rb.header("User-Agent", VR_UA),
        "yt_ios" => rb.header("User-Agent", IOS_UA),
        "vk" => rb.header("User-Agent", KATE_UA),
        _ => rb.header("User-Agent", BROWSER_UA),
    }
}

fn status(code: StatusCode, msg: &str) -> Response<Body> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(msg.to_string()))
        .unwrap()
}

async fn remote(Query(q): Query<RemoteQ>, headers: HeaderMap) -> Response<Body> {
    if q.k != key() {
        return status(StatusCode::FORBIDDEN, "bad key");
    }
    if !(q.u.starts_with("https://") || q.u.starts_with("http://")) {
        return status(StatusCode::BAD_REQUEST, "bad url");
    }
    let mut rb = apply_profile(client().get(&q.u), q.c.as_deref().unwrap_or("browser"));
    if let Some(range) = headers.get(header::RANGE).and_then(|r| r.to_str().ok()) {
        rb = rb.header("Range", range);
    }
    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => return status(StatusCode::BAD_GATEWAY, &e.to_string()),
    };
    let mut b = Response::builder()
        .status(resp.status().as_u16())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Length, Content-Range, Accept-Ranges");
    for name in ["content-type", "content-length", "content-range", "accept-ranges"] {
        if let Some(v) = resp.headers().get(name) {
            b = b.header(name, v.as_bytes());
        }
    }
    b.body(Body::from_stream(resp.bytes_stream())).unwrap_or_else(|_| status(StatusCode::BAD_GATEWAY, "body"))
}

async fn hls(Query(q): Query<RemoteQ>) -> Response<Body> {
    if q.k != key() {
        return status(StatusCode::FORBIDDEN, "bad key");
    }
    let profile = q.c.clone().unwrap_or_else(|| "browser".into());
    let text = match apply_profile(client().get(&q.u), &profile).send().await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return status(StatusCode::BAD_GATEWAY, &e.to_string()),
    };
    let base_url = match url::Url::parse(&q.u) {
        Ok(u) => u,
        Err(_) => return status(StatusCode::BAD_REQUEST, "bad url"),
    };
    Response::builder()
        .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(rewrite_playlist(&text, &base_url, &profile)))
        .unwrap()
}

/// Makes every URI in an m3u8 absolute and routes it through the proxy.
pub fn rewrite_playlist(text: &str, base_url: &url::Url, profile: &str) -> String {
    let uri_re = regex::Regex::new(r#"URI="([^"]+)""#).unwrap();
    let mut out = String::with_capacity(text.len() * 2);
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() {
        } else if l.starts_with('#') {
            let replaced = uri_re.replace_all(l, |c: &regex::Captures| {
                let abs = base_url.join(&c[1]).map(|u| u.to_string()).unwrap_or_else(|_| c[1].to_string());
                format!("URI=\"{}\"", remote_url("p", &abs, profile))
            });
            out.push_str(&replaced);
        } else {
            let abs = base_url.join(l).map(|u| u.to_string()).unwrap_or_else(|_| l.to_string());
            let route = if abs.split('?').next().unwrap_or("").ends_with(".m3u8") { "hls" } else { "p" };
            out.push_str(&remote_url(route, &abs, profile));
        }
        out.push('\n');
    }
    out
}

fn mime_for(path: &str) -> &'static str {
    let p = path.to_ascii_lowercase();
    if p.ends_with(".mp3") {
        "audio/mpeg"
    } else if p.ends_with(".m4a") || p.ends_with(".mp4") {
        "audio/mp4"
    } else if p.ends_with(".webm") {
        "audio/webm"
    } else if p.ends_with(".ogg") || p.ends_with(".opus") {
        "audio/ogg"
    } else if p.ends_with(".flac") {
        "audio/flac"
    } else if p.ends_with(".aac") {
        "audio/aac"
    } else if p.ends_with(".wav") {
        "audio/wav"
    } else {
        ""
    }
}

async fn file(Query(q): Query<FileQ>, headers: HeaderMap) -> Response<Body> {
    if q.k != key() {
        return status(StatusCode::FORBIDDEN, "bad key");
    }
    let mime = mime_for(&q.path);
    if mime.is_empty() {
        return status(StatusCode::FORBIDDEN, "not audio");
    }
    let mut f = match tokio::fs::File::open(&q.path).await {
        Ok(f) => f,
        Err(_) => return status(StatusCode::NOT_FOUND, "not found"),
    };
    let len = f.metadata().await.map(|m| m.len()).unwrap_or(0);
    if len == 0 {
        return status(StatusCode::NOT_FOUND, "empty");
    }
    let range = headers.get(header::RANGE).and_then(|r| r.to_str().ok()).and_then(|r| parse_range(r, len));
    let (start, end, partial) = match range {
        Some((s, e)) => (s, e, true),
        None => (0, len - 1, false),
    };
    if f.seek(SeekFrom::Start(start)).await.is_err() {
        return status(StatusCode::RANGE_NOT_SATISFIABLE, "seek");
    }
    let stream = tokio_util::io::ReaderStream::new(f.take(end - start + 1));
    let mut b = Response::builder()
        .status(if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, (end - start + 1).to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if partial {
        b = b.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    b.body(Body::from_stream(stream)).unwrap()
}

fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len - 1)
    } else {
        let s: u64 = a.parse().ok()?;
        let e: u64 = if b.is_empty() { len - 1 } else { b.parse::<u64>().ok()?.min(len - 1) };
        (s, e)
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end))
}
