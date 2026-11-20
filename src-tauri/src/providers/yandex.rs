//! Yandex Music through the API used by the official mobile apps.
use crate::accounts;
use crate::http::{client, err};
use crate::model::{RawStream, Track};
use md5::{Digest, Md5};
use serde_json::Value;

const API: &str = "https://api.music.yandex.net";
const CLIENT_ID: &str = "23cabbbdc6cd418abb4b39c32c41195d";
const SIGN_SALT: &str = "XGRlBW9FXlekgbPrRHuSiA";

pub fn oauth_url() -> String {
    format!("https://oauth.yandex.ru/authorize?response_type=token&client_id={CLIENT_ID}")
}

fn token() -> Result<String, String> {
    accounts::get().ym_token.ok_or_else(|| "Яндекс Музыка: войдите в аккаунт в настройках".to_string())
}

fn req(builder: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder, String> {
    Ok(builder
        .header("Authorization", format!("OAuth {}", token()?))
        .header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
        .header("Accept-Language", "ru"))
}

async fn get(path: &str) -> Result<Value, String> {
    let res: Value = req(client().get(format!("{API}{path}")))?
        .send()
        .await
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;
    if let Some(e) = res.get("error") {
        return Err(format!("Яндекс Музыка: {}", e.get("message").and_then(|m| m.as_str()).unwrap_or("ошибка")));
    }
    Ok(res.get("result").cloned().unwrap_or(Value::Null))
}

fn parse(v: &Value) -> Option<Track> {
    let id = match v.get("id")? {
        Value::String(s) => s.clone(),
        n => n.to_string(),
    };
    let mut t = Track::new("yandex", id.clone());
    t.title = v.get("title")?.as_str()?.to_string();
    if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
        t.title = format!("{} ({ver})", t.title);
    }
    t.artist = v
        .get("artists")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.get("name")?.as_str()).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    t.album = v.pointer("/albums/0/title").and_then(|a| a.as_str()).map(String::from);
    t.duration = (v.get("durationMs").and_then(|d| d.as_u64()).unwrap_or(0) / 1000) as u32;
    t.cover = v
        .get("coverUri")
        .and_then(|c| c.as_str())
        .map(|c| format!("https://{}", c.replace("%%", "400x400")));
    let album_id = v.pointer("/albums/0/id").map(|a| a.to_string());
    t.link = Some(match album_id {
        Some(a) => format!("https://music.yandex.ru/album/{a}/track/{id}"),
        None => format!("https://music.yandex.ru/track/{id}"),
    });
    t.unavailable = v.get("available").and_then(|a| a.as_bool()) == Some(false);
    Some(t)
}

pub async fn search(query: &str, limit: usize) -> Result<Vec<Track>, String> {
    let res = get(&format!("/search?text={}&type=track&page=0&nocorrect=false", urlencoding::encode(query))).await?;
    Ok(res
        .pointer("/tracks/results")
        .and_then(|r| r.as_array())
        .map(|a| a.iter().filter_map(parse).take(limit).collect())
        .unwrap_or_default())
}

/// Fills uid and login after sign-in.
pub async fn load_account() -> Result<(), String> {
    let res = get("/account/status").await?;
    let uid = res.pointer("/account/uid").map(|u| u.to_string());
    let login = res.pointer("/account/login").and_then(|l| l.as_str()).map(String::from);
    accounts::update(|a| {
        a.ym_uid = uid;
        a.ym_login = login;
    });
    Ok(())
}

/// "Мне нравится" of the signed-in user.
pub async fn likes() -> Result<Vec<Track>, String> {
    if accounts::get().ym_uid.is_none() {
        load_account().await?;
    }
    let uid = accounts::get().ym_uid.ok_or("Яндекс Музыка: нет uid")?;
    let lib = get(&format!("/users/{uid}/likes/tracks")).await?;
    let ids: Vec<String> = lib
        .pointer("/library/tracks")
        .and_then(|t| t.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    let id = x.get("id")?.as_str().map(String::from).or_else(|| Some(x.get("id")?.to_string()))?;
                    Some(match x.get("albumId") {
                        Some(al) => format!("{id}:{}", al.as_str().map(String::from).unwrap_or_else(|| al.to_string())),
                        None => id,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let mut out = Vec::new();
    for chunk in ids.chunks(200) {
        let res: Value = req(client().post(format!("{API}/tracks")))?
            .form(&[("track-ids", chunk.join(",")), ("with-positions", "false".into())])
            .send()
            .await
            .map_err(err)?
            .json()
            .await
            .map_err(err)?;
        if let Some(arr) = res.get("result").and_then(|r| r.as_array()) {
            out.extend(arr.iter().filter_map(parse));
        }
    }
    Ok(out)
}

pub async fn stream(track_id: &str) -> Result<RawStream, String> {
    let infos = get(&format!("/tracks/{track_id}/download-info")).await?;
    let best = infos
        .as_array()
        .ok_or("Яндекс Музыка: нет потоков")?
        .iter()
        .filter(|i| i.get("codec").and_then(|c| c.as_str()) == Some("mp3"))
        .max_by_key(|i| i.get("bitrateInKbps").and_then(|b| b.as_u64()).unwrap_or(0))
        .ok_or("Яндекс Музыка: трек недоступен (нужна подписка?)")?;
    let info_url = best.get("downloadInfoUrl").and_then(|u| u.as_str()).ok_or("нет downloadInfoUrl")?;
    let xml = req(client().get(info_url))?.send().await.map_err(err)?.text().await.map_err(err)?;
    let tag = |name: &str| -> Option<String> {
        let re = regex::Regex::new(&format!("<{name}>([^<]*)</{name}>")).ok()?;
        re.captures(&xml).map(|c| c[1].to_string())
    };
    let host = tag("host").ok_or("нет host")?;
    let path = tag("path").ok_or("нет path")?;
    let ts = tag("ts").ok_or("нет ts")?;
    let s = tag("s").ok_or("нет s")?;
    let mut h = Md5::new();
    h.update(format!("{SIGN_SALT}{}{s}", path.trim_start_matches('/')));
    let sign = format!("{:x}", h.finalize());
    Ok(RawStream { url: format!("https://{host}/get-mp3/{sign}/{ts}{path}"), hls: false, profile: "browser", ext: "mp3", headers: vec![] })
}

/// Token comes back in the fragment of the redirect page.
pub fn capture(url: &url::Url) -> Option<String> {
    let frag = url.fragment()?;
    if !frag.contains("access_token=") {
        return None;
    }
    url::form_urlencoded::parse(frag.as_bytes())
        .find(|(k, _)| k == "access_token")
        .map(|(_, v)| v.to_string())
}
