//! Discord Rich Presence ("Слушает ...").
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::Mutex;

static CLIENT: Mutex<Option<(String, DiscordIpcClient)>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub client_id: String,
    pub title: String,
    pub artist: String,
    pub cover: Option<String>,
    pub link: Option<String>,
    /// Unix seconds when the track started (adjusted for position).
    pub started_at: Option<i64>,
    pub paused: bool,
}

fn ensure(client_id: &str) -> Result<(), String> {
    let mut guard = CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some((id, _)) = guard.as_ref() {
        if id == client_id {
            return Ok(());
        }
    }
    if let Some((_, mut old)) = guard.take() {
        let _ = old.close();
    }
    let mut c = DiscordIpcClient::new(client_id).map_err(|e| e.to_string())?;
    c.connect().map_err(|e| format!("Discord не запущен? {e}"))?;
    *guard = Some((client_id.to_string(), c));
    Ok(())
}

pub fn set(p: Presence) -> Result<(), String> {
    if p.client_id.trim().is_empty() {
        return Err("Укажите Application ID Discord".into());
    }
    ensure(&p.client_id)?;
    let mut guard = CLIENT.lock().map_err(|e| e.to_string())?;
    let (_, c) = guard.as_mut().ok_or("нет соединения")?;
    let state = format!("{}{}", p.artist, if p.paused { " · пауза" } else { "" });
    if c.set_activity(build(&p, &state)).is_err() {
        // Discord restarted: reconnect once.
        let _ = c.reconnect();
        c.set_activity(build(&p, &state)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn build<'a>(p: &'a Presence, state: &'a str) -> activity::Activity<'a> {
    let mut assets = activity::Assets::new().large_text(&p.title);
    if let Some(cover) = p.cover.as_deref().filter(|c| c.starts_with("https://")) {
        assets = assets.large_image(cover);
    }
    let mut act = activity::Activity::new().details(&p.title).state(state).assets(assets);
    if let (Some(start), false) = (p.started_at, p.paused) {
        act = act.timestamps(activity::Timestamps::new().start(start));
    }
    if let Some(link) = p.link.as_deref() {
        act = act.buttons(vec![activity::Button::new("Слушать", link)]);
    }
    act
}

pub fn clear() {
    if let Ok(mut guard) = CLIENT.lock() {
        if let Some((_, c)) = guard.as_mut() {
            let _ = c.clear_activity();
        }
    }
}
