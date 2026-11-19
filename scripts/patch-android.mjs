// Run after `tauri android init`. Lets the release app talk to its own
// audio proxy on http://127.0.0.1 (Android blocks plain HTTP by default).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const gradle = "src-tauri/gen/android/app/build.gradle.kts";
const manifest = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";

if (!existsSync(gradle)) {
  console.error("Сначала выполните: npx tauri android init");
  process.exit(1);
}

let g = readFileSync(gradle, "utf8");
const before = g;
g = g.replace(/manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"false"/g, 'manifestPlaceholders["usesCleartextTraffic"] = "true"');
if (g !== before) {
  writeFileSync(gradle, g);
  console.log("build.gradle.kts: cleartext для 127.0.0.1 включён");
} else if (existsSync(manifest)) {
  let m = readFileSync(manifest, "utf8");
  if (!m.includes("usesCleartextTraffic")) {
    m = m.replace("<application", '<application android:usesCleartextTraffic="true"');
    writeFileSync(manifest, m);
    console.log("AndroidManifest.xml: cleartext включён");
  } else {
    console.log("Уже настроено");
  }
}

// Keep playing in the background: media playback foreground permission.
if (existsSync(manifest)) {
  let m = readFileSync(manifest, "utf8");
  if (!m.includes("android.permission.WAKE_LOCK")) {
    m = m.replace("<application", '<uses-permission android:name="android.permission.WAKE_LOCK" />\n    <application');
    writeFileSync(manifest, m);
    console.log("AndroidManifest.xml: WAKE_LOCK добавлен");
  }
}
