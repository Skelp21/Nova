use std::sync::OnceLock;
use std::time::Duration;

pub const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// One shared HTTP client for every provider (connection pooling, gzip/brotli).
pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(BROWSER_UA)
            .connect_timeout(Duration::from_secs(10))
            .pool_idle_timeout(Duration::from_secs(60))
            .build()
            .expect("http client")
    })
}

/// Turns any error into a String so it can cross the Tauri IPC boundary.
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
