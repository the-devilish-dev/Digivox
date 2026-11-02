# 🗣️ DigiVoX

MultiAgent voice studio suite by **Devilish Labs**.

| App | What it does |
|---|---|
| `index.html` | DigiVoX Hub — launcher for the suite |
| `Yapper.html` | Two AI personas auto-chat with neural TTS voices (v4.1.4) |
| `DigiVoice.html` | Neural voice synth + clone studio |
| `PodcastGen.html` | Podcast script + voice generation |
| `ScriptedPerformance.html` | Scripted multi-voice performances |

## Architecture

Plain HTML/CSS/JS single-page apps. `dl_proxy.js` is a zero-dependency Node proxy
(localhost:2345) that routes fish.audio calls (`/tts`, `/voices`, `/clone`, `/transcribe`)
with CORS headers — the fish.audio API does not allow browser-originated requests.

- **Desktop/Termux dev:** serve this folder with `node dl_proxy.js`, open `http://localhost:2345/`
- **Android phone:** `start_digivox.sh` / `stop_digivox.sh` (Termux widget launchers)
- **APK:** the apps detect the WebView's `https://localhost` origin and reach the
  on-device Termux proxy at `http://localhost:2345` automatically
- **Custom server:** set `devilish_server_base` in localStorage (DigiVoX settings) to any
  proxy that exposes the same routes

API keys (fish.audio, Google Gemini, DeepSeek) are entered in-app and stored only in
browser localStorage (`devilish_fish_key`, `devilish_gemini_key`). They are never in this repo.

## Current model IDs

- Brain models: `gemini-3.5-flash`, `gemini-3.5-pro`, `deepseek-flash`, `deepseek-v4-pro`
- TTS: fish.audio (`s1`, `s2-pro`) or `gemini-3.1-flash-tts-preview`

## Note

`vox_viz.gif` (hub animation asset, binary) is not in git — add via GitHub web UI if needed.

---
Brought to you by THE DEVILISH.DEV™ & HauntMedia™
