//! Saves tracks to disk for offline playback. Handles progressive files and
//! HLS (AES-128 encrypted segments, MPEG-TS demux to a plain mp3/aac file).
use crate::http::{client, err};
use crate::model::{RawStream, Track};
use crate::proxy::{apply_headers, apply_profile};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    progress: f64,
}

fn sanitize(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    trimmed.chars().take(120).collect()
}

fn emit(app: &AppHandle, id: &str, progress: f64) {
    let _ = app.emit("download-progress", Progress { id, progress });
}

pub async fn download(app: &AppHandle, track: &Track, raw: RawStream, dir: &Path) -> Result<String, String> {
    tokio::fs::create_dir_all(dir).await.map_err(err)?;
    let base = sanitize(&format!("{} - {}", track.artist, track.title));
    let (bytes, ext) = if raw.hls {
        download_hls(app, track, &raw).await?
    } else {
        (download_progressive(app, track, &raw).await?, raw.ext.to_string())
    };
    let mut path: PathBuf = dir.join(format!("{base}.{ext}"));
    let mut n = 1;
    while path.exists() {
        n += 1;
        path = dir.join(format!("{base} ({n}).{ext}"));
    }
    let mut f = tokio::fs::File::create(&path).await.map_err(err)?;
    f.write_all(&bytes).await.map_err(err)?;
    f.flush().await.map_err(err)?;
    emit(app, &track.id, 1.0);
    Ok(path.to_string_lossy().to_string())
}

async fn download_progressive(app: &AppHandle, track: &Track, raw: &RawStream) -> Result<Vec<u8>, String> {
    let resp = apply_headers(client().get(&raw.url), raw.profile, &raw.headers)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?;
    let total = resp.content_length().unwrap_or(0);
    let mut buf = Vec::with_capacity(total as usize);
    let mut stream = resp.bytes_stream();
    let mut last = 0.0;
    while let Some(chunk) = stream.next().await {
        buf.extend_from_slice(&chunk.map_err(err)?);
        if total > 0 {
            let p = buf.len() as f64 / total as f64;
            if p - last > 0.02 {
                last = p;
                emit(app, &track.id, p * 0.99);
            }
        }
    }
    Ok(buf)
}

async fn fetch_text(url: &str, profile: &str) -> Result<String, String> {
    apply_profile(client().get(url), profile).send().await.map_err(err)?.text().await.map_err(err)
}

async fn fetch_bytes(url: &str, profile: &str) -> Result<Vec<u8>, String> {
    Ok(apply_profile(client().get(url), profile)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?
        .bytes()
        .await
        .map_err(err)?
        .to_vec())
}

struct Segment {
    url: String,
    key: Option<(String, Option<[u8; 16]>)>,
    seq: u64,
}

fn parse_iv(s: &str) -> Option<[u8; 16]> {
    let hex = s.trim_start_matches("0x").trim_start_matches("0X");
    let v = u128::from_str_radix(hex, 16).ok()?;
    Some(v.to_be_bytes())
}

async fn download_hls(app: &AppHandle, track: &Track, raw: &RawStream) -> Result<(Vec<u8>, String), String> {
    let mut url = url::Url::parse(&raw.url).map_err(err)?;
    let mut text = fetch_text(url.as_str(), raw.profile).await?;
    // Master playlist: take the first variant.
    if text.contains("#EXT-X-STREAM-INF") {
        let variant = text
            .lines()
            .skip_while(|l| !l.starts_with("#EXT-X-STREAM-INF"))
            .find(|l| !l.trim().is_empty() && !l.starts_with('#'))
            .ok_or("HLS: нет вариантов")?
            .trim()
            .to_string();
        url = url.join(&variant).map_err(err)?;
        text = fetch_text(url.as_str(), raw.profile).await?;
    }
    let attr_re = regex::Regex::new(r#"([A-Z\-]+)=("[^"]*"|[^,]*)"#).unwrap();
    let mut segments = Vec::new();
    let mut seq: u64 = 0;
    let mut key: Option<(String, Option<[u8; 16]>)> = None;
    for line in text.lines().map(str::trim) {
        if let Some(v) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            seq = v.parse().unwrap_or(0);
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-KEY:") {
            let map: HashMap<String, String> = attr_re
                .captures_iter(attrs)
                .map(|c| (c[1].to_string(), c[2].trim_matches('"').to_string()))
                .collect();
            key = match map.get("METHOD").map(String::as_str) {
                Some("AES-128") => {
                    let uri = url.join(map.get("URI").map(String::as_str).unwrap_or("")).map_err(err)?.to_string();
                    Some((uri, map.get("IV").and_then(|iv| parse_iv(iv))))
                }
                _ => None,
            };
        } else if !line.is_empty() && !line.starts_with('#') {
            segments.push(Segment { url: url.join(line).map_err(err)?.to_string(), key: key.clone(), seq });
            seq += 1;
        }
    }
    if segments.is_empty() {
        return Err("HLS: пустой плейлист".into());
    }
    let mut keys: HashMap<String, Vec<u8>> = HashMap::new();
    let mut out = Vec::new();
    let total = segments.len();
    for (i, seg) in segments.iter().enumerate() {
        let mut data = fetch_bytes(&seg.url, raw.profile).await?;
        if let Some((key_url, iv)) = &seg.key {
            if !keys.contains_key(key_url) {
                keys.insert(key_url.clone(), fetch_bytes(key_url, raw.profile).await?);
            }
            let k = &keys[key_url];
            if k.len() != 16 {
                return Err("HLS: неверный ключ".into());
            }
            let iv = iv.unwrap_or_else(|| (seg.seq as u128).to_be_bytes());
            let key_arr: [u8; 16] = k[..16].try_into().map_err(err)?;
            data = Aes128CbcDec::new(&key_arr.into(), &iv.into())
                .decrypt_padded_vec_mut::<Pkcs7>(&data)
                .map_err(|_| "HLS: ошибка расшифровки".to_string())?;
        }
        if data.first() == Some(&0x47) && data.len() >= 188 {
            out.extend(ts_to_es(&data));
        } else {
            out.extend(data);
        }
        emit(app, &track.id, (i + 1) as f64 / total as f64 * 0.99);
    }
    let ext = if is_adts(&out) { "aac" } else { "mp3" };
    Ok((out, ext.to_string()))
}

fn is_adts(data: &[u8]) -> bool {
    // ADTS: sync 0xFFF and layer bits == 00 (MP3 frames have non-zero layer).
    data.len() > 2 && data[0] == 0xFF && (data[1] & 0xF0) == 0xF0 && (data[1] & 0x06) == 0
}

/// Extracts the first audio elementary stream from MPEG-TS packets.
fn ts_to_es(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut pmt_pid: Option<u16> = None;
    let mut audio_pid: Option<u16> = None;
    for pkt in data.chunks_exact(188) {
        if pkt[0] != 0x47 {
            continue;
        }
        let pusi = pkt[1] & 0x40 != 0;
        let pid = (((pkt[1] & 0x1f) as u16) << 8) | pkt[2] as u16;
        let afc = (pkt[3] >> 4) & 3;
        let mut start = 4usize;
        if afc == 0 || afc == 2 {
            continue;
        }
        if afc == 3 {
            start += 1 + pkt[4] as usize;
        }
        if start >= 188 {
            continue;
        }
        let payload = &pkt[start..];
        let section = |p: &[u8]| -> Option<Vec<u8>> {
            let ptr = *p.first()? as usize;
            p.get(1 + ptr..).map(|s| s.to_vec())
        };
        if pid == 0 && pusi {
            if let Some(p) = section(payload) {
                if p.len() >= 12 {
                    pmt_pid = Some((((p[10] & 0x1f) as u16) << 8) | p[11] as u16);
                }
            }
        } else if Some(pid) == pmt_pid && pusi && audio_pid.is_none() {
            if let Some(p) = section(payload) {
                if p.len() < 12 {
                    continue;
                }
                let sec_len = (((p[1] & 0x0f) as usize) << 8) | p[2] as usize;
                let prog_info = (((p[10] & 0x0f) as usize) << 8) | p[11] as usize;
                let end = (3 + sec_len).saturating_sub(4).min(p.len());
                let mut j = 12 + prog_info;
                while j + 5 <= end {
                    let stream_type = p[j];
                    let epid = (((p[j + 1] & 0x1f) as u16) << 8) | p[j + 2] as u16;
                    let info_len = (((p[j + 3] & 0x0f) as usize) << 8) | p[j + 4] as usize;
                    // 0x03/0x04 MPEG audio, 0x0f AAC ADTS, 0x11 AAC LATM
                    if matches!(stream_type, 0x03 | 0x04 | 0x0f | 0x11) {
                        audio_pid = Some(epid);
                        break;
                    }
                    j += 5 + info_len;
                }
            }
        } else if Some(pid) == audio_pid {
            if pusi {
                if payload.len() < 9 {
                    continue;
                }
                let hdr = 9 + payload[8] as usize;
                if let Some(es) = payload.get(hdr..) {
                    out.extend_from_slice(es);
                }
            } else {
                out.extend_from_slice(payload);
            }
        }
    }
    out
}
