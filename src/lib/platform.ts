/** True inside the Android/iOS app (Tauri mobile uses the system WebView). */
export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

export function applyPlatformClass() {
  document.documentElement.classList.toggle("mobile", isMobile);
  document.documentElement.classList.toggle("ios", isIOS);
}
