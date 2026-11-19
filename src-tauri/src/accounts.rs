//! Tokens for VK and Yandex Music, stored in the app config folder.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Accounts {
    #[serde(default)]
    pub vk_token: Option<String>,
    #[serde(default)]
    pub vk_user_id: Option<String>,
    #[serde(default)]
    pub ym_token: Option<String>,
    #[serde(default)]
    pub ym_uid: Option<String>,
    #[serde(default)]
    pub ym_login: Option<String>,
}

/// What the UI is allowed to see (no raw tokens).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountsStatus {
    pub vk: bool,
    pub vk_user_id: Option<String>,
    pub yandex: bool,
    pub yandex_login: Option<String>,
}

static PATH: OnceLock<PathBuf> = OnceLock::new();
static STATE: Mutex<Option<Accounts>> = Mutex::new(None);

pub fn init(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("accounts.json");
    let acc = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let _ = PATH.set(path);
    *STATE.lock().unwrap() = Some(acc);
}

pub fn get() -> Accounts {
    STATE.lock().unwrap().clone().unwrap_or_default()
}

pub fn update(f: impl FnOnce(&mut Accounts)) {
    let mut guard = STATE.lock().unwrap();
    let acc = guard.get_or_insert_with(Accounts::default);
    f(acc);
    if let Some(p) = PATH.get() {
        if let Ok(s) = serde_json::to_string_pretty(acc) {
            let _ = std::fs::write(p, s);
        }
    }
}

pub fn status() -> AccountsStatus {
    let a = get();
    AccountsStatus {
        vk: a.vk_token.is_some(),
        vk_user_id: a.vk_user_id,
        yandex: a.ym_token.is_some(),
        yandex_login: a.ym_login,
    }
}
