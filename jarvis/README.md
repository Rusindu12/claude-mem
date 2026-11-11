# J.A.R.V.I.S — Android AI assistant (සිංහල + English)

A voice assistant app for Android that understands and speaks Sinhala and English.

- `app/src/main/assets/www/` — the interface and assistant logic (HTML/CSS/JS)
- `app/src/main/java/com/rusindu/jarvis/MainActivity.java` — native shell: speech recognition, text-to-speech, device actions

## What it does

- Voice in / voice out in Sinhala (`si-LK`) and English, plus typing
- AI answers through Google Gemini or any OpenAI-compatible API (add your own key in ⚙ Settings)
- Works without a key for: time, date, battery, torch, opening apps, web search, YouTube search
- With AI connected it can also set alarms and timers, open Maps, and open the dialler
- **Phone control**: give it a task ("open YouTube and play …", "send … on WhatsApp") and it operates the
  apps itself — reading the screen, tapping, typing and scrolling — through an Android accessibility service
  (`AgentService.java`). A floating STOP button is shown while it works; it is limited to 25 steps per task,
  never touches password fields, and is instructed not to pay, buy or delete anything
- Hands-free mode: keeps listening after each reply
- Remembers the recent conversation on the phone

## Get the APK

Every push that touches `jarvis/` runs the **Build J.A.R.V.I.S APK** workflow
(`.github/workflows/jarvis-apk.yml`). It uploads `JARVIS.apk` as a workflow artifact and
publishes it on the `jarvis-apk` pre-release of this repository.

## Build locally

Requires JDK 17, the Android SDK (platform 34) and Gradle 8.7+.

```bash
cd jarvis
gradle assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

## Phone setup

1. Install the APK (allow "install unknown apps" when asked).
2. Allow the microphone when prompted.
3. For Sinhala speech: Settings → System → Languages → Text-to-speech → Google → install **සිංහල** voice data.
4. For phone control: Settings → Accessibility → **J.A.R.V.I.S phone control** → On. On Android 13+ a sideloaded
   app is blocked at first: open Settings → Apps → J.A.R.V.I.S → ⋮ → **Allow restricted settings**, then retry.
   While a task runs, the text on screen is sent to the AI provider you configured.
5. Tap ⚙ in the app and paste an API key (a free Gemini key: https://aistudio.google.com/apikey).
