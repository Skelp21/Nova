mod accounts;
#[cfg(desktop)]
mod discord;
mod downloads;
mod http;
mod model;
mod providers;
mod proxy;

use http::err;
use model::{ImportedPlaylist, Lyrics, StreamInfo, Track};
use providers::{lyrics as lyrics_src, spotify, vk, yandex};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

// ---------- search / playback ----------

#[tauri::command]
async fn search(source: String, query: String, limit: Option<usize>) -> Result<Vec<Track>, String> {
    providers::search(&source, &query, limit.unwrap_or(30)).await
}

#[tauri::command]
async fn resolve_stream(track: Track, local_path: Option<String>) -> Result<StreamInfo, String> {
    if let Some(p) = local_path.filter(|p| std::path::Path::new(p).exists()) {
        return Ok(proxy::local_file(&p));
    }
    let raw = providers::stream(&track).await?;
    Ok(proxy::proxied(&raw))
}

#[tauri::command]
async fn radio(track: Track) -> Result<Vec<Track>, String> {
    providers::radio(&track).await
}

#[tauri::command]
async fn lyrics(title: String, artist: String, duration: u32) -> Result<Lyrics, String> {
    lyrics_src::find(&title, &artist, duration).await
}

// ---------- imports ----------

#[tauri::command]
async fn spotify_import(link: String) -> Result<ImportedPlaylist, String> {
    spotify::import(&link).await
}

#[tauri::command]
async fn vk_my_audio() -> Result<Vec<Track>, String> {
    vk::my_audio().await
}

#[tauri::command]
async fn yandex_likes() -> Result<Vec<Track>, String> {
    yandex::likes().await
}

// ---------- accounts ----------

#[tauri::command]
fn accounts_status() -> accounts::AccountsStatus {
    accounts::status()
}

#[tauri::command]
async fn auth_set_token(app: AppHandle, provider: String, token: String) -> Result<(), String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Пустой токен".into());
    }
    match provider.as_str() {
        "vk" => accounts::update(|a| a.vk_token = Some(token)),
        "yandex" => {
            accounts::update(|a| a.ym_token = Some(token));
            if let Err(e) = yandex::load_account().await {
                accounts::update(|a| a.ym_token = None);
                return Err(e);
            }
        }
        _ => return Err("Неизвестный сервис".into()),
    }
    let _ = app.emit("accounts-changed", provider);
    Ok(())
}

#[tauri::command]
fn auth_logout(app: AppHandle, provider: String) {
    accounts::update(|a| match provider.as_str() {
        "vk" => {
            a.vk_token = None;
            a.vk_user_id = None;
        }
        "yandex" => {
            a.ym_token = None;
            a.ym_uid = None;
            a.ym_login = None;
        }
        _ => {}
    });
    let _ = app.emit("accounts-changed", provider);
}

/// Returns true when the URL carried a token (and the window can close).
#[cfg(desktop)]
fn handle_auth_redirect(app: &AppHandle, provider: &str, url: &url::Url) -> bool {
    let done = match provider {
        "vk" => match vk::capture(url) {
            Some((token, uid)) => {
                accounts::update(|a| {
                    a.vk_token = Some(token);
                    a.vk_user_id = Some(uid);
                });
                true
            }
            None => false,
        },
        "yandex" => match yandex::capture(url) {
            Some(token) => {
                accounts::update(|a| a.ym_token = Some(token));
                true
            }
            None => false,
        },
        _ => false,
    };
    if done {
        let app = app.clone();
        let provider = provider.to_string();
        tauri::async_runtime::spawn(async move {
            if provider == "yandex" {
                let _ = yandex::load_account().await;
            }
            let _ = app.emit("accounts-changed", &provider);
            if let Some(w) = app.get_webview_window(&format!("auth-{provider}")) {
                let _ = w.close();
            }
        });
    }
    done
}

#[cfg(mobile)]
#[tauri::command]
async fn auth_login(_app: AppHandle, _provider: String) -> Result<(), String> {
    Err("На телефоне вставьте токен вручную (кнопка с ключом)".into())
}

#[cfg(desktop)]
#[tauri::command]
async fn auth_login(app: AppHandle, provider: String) -> Result<(), String> {
    let (title, url) = match provider.as_str() {
        "vk" => ("Вход во ВКонтакте", vk::oauth_url()),
        "yandex" => ("Вход в Яндекс", yandex::oauth_url()),
        _ => return Err("Неизвестный сервис".into()),
    };
    let label = format!("auth-{provider}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        return Ok(());
    }
    let (app_nav, prov_nav) = (app.clone(), provider.clone());
    let (app_load, prov_load) = (app.clone(), provider.clone());
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.parse().map_err(err)?))
        .title(title)
        .inner_size(520.0, 720.0)
        .center()
        .on_navigation(move |u| !handle_auth_redirect(&app_nav, &prov_nav, u))
        .on_page_load(move |_w, payload| {
            handle_auth_redirect(&app_load, &prov_load, payload.url());
        })
        .build()
        .map_err(err)?;
    Ok(())
}

// ---------- library ----------

fn library_path() -> Result<PathBuf, String> {
    Ok(DATA_DIR.get().ok_or("нет папки данных")?.join("library.json"))
}

#[tauri::command]
fn library_load() -> Result<Value, String> {
    let p = library_path()?;
    match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).map_err(err),
        Err(_) => Ok(Value::Null),
    }
}

#[tauri::command]
fn library_save(data: Value) -> Result<(), String> {
    let p = library_path()?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&data).map_err(err)?).map_err(err)?;
    std::fs::rename(&tmp, &p).map_err(err)
}

// ---------- downloads ----------

#[tauri::command]
fn default_download_dir(app: AppHandle) -> Result<String, String> {
    // Phones have no shared Music folder for apps: keep files in app data.
    let base = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().app_data_dir())
        .map_err(err)?;
    Ok(base.join("Nota").to_string_lossy().to_string())
}

#[tauri::command]
async fn download_track(app: AppHandle, track: Track, dir: String) -> Result<String, String> {
    let raw = providers::stream(&track).await?;
    downloads::download(&app, &track, raw, std::path::Path::new(&dir)).await
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(path).map_err(err)
}

// ---------- discord (desktop only) ----------

#[cfg(desktop)]
#[tauri::command]
fn discord_set(presence: discord::Presence) -> Result<(), String> {
    discord::set(presence)
}

#[cfg(mobile)]
#[tauri::command]
fn discord_set(presence: Value) -> Result<(), String> {
    let _ = presence;
    Err("Discord доступен только на ПК".into())
}

#[tauri::command]
fn discord_clear() {
    #[cfg(desktop)]
    discord::clear();
}

// ---------- windows ----------

#[cfg(mobile)]
#[tauri::command]
async fn open_miniplayer(_app: AppHandle) -> Result<(), String> {
    Err("Мини-плеер есть только на ПК".into())
}

/// Async: building windows inside a sync command deadlocks on Windows.
#[cfg(desktop)]
#[tauri::command]
async fn open_miniplayer(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("miniplayer") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "miniplayer", WebviewUrl::App("miniplayer.html".into()))
        .title("Nota — мини-плеер")
        .inner_size(400.0, 116.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .build()
        .map_err(err)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            accounts::init(config);
            let _ = providers::youtube::TOOLS_DIR.set(data.join("tools"));
            let _ = DATA_DIR.set(data);
            proxy::start().map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app (and the miniplayer).
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    #[cfg(desktop)]
                    discord::clear();
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            search,
            resolve_stream,
            radio,
            lyrics,
            spotify_import,
            vk_my_audio,
            yandex_likes,
            accounts_status,
            auth_set_token,
            auth_logout,
            auth_login,
            library_load,
            library_save,
            default_download_dir,
            download_track,
            file_exists,
            delete_file,
            discord_set,
            discord_clear,
            open_miniplayer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nota");
}
