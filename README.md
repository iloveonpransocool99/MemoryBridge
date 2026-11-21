# MemoryBridge 💛

Talking Photos & Birthday Video Maker for elderly people and their families.
Runs entirely in the browser — no server, no accounts, no uploads. Your photos
never leave your device. Installable on iPhone as an app (PWA) and deployable
to Cloudflare Pages as a static site.

## How to run

Any of these works — it is a plain static website:

**Option A — just open the file**

1. Open the `memorybridge` folder.
2. Double-click `index.html`. It opens in your browser (Chrome, Edge, Safari, or Firefox).

**Option B — local server (needed for PWA/service-worker testing)**

```bash
cd memorybridge
python3 -m http.server 8000
```

Then visit http://localhost:8000

> The service worker only activates on `http://localhost` or `https://` —
> opening via `file://` still works for the app itself, but the offline
> install features need Option B or a deployed URL.

## Deploying to Cloudflare Pages (step by step)

MemoryBridge is 100% static — perfect for Cloudflare Pages' free tier.

1. Put the `memorybridge` folder into a GitHub repository
   (GitHub.com → New repository → Upload the files).
2. Go to https://dash.cloudflare.com and sign up / log in (free plan is fine).
3. In the left menu choose **Workers & Pages**, then click **Create**, and
   pick the **Pages** tab.
4. Choose **Connect to Git**, authorize GitHub, and select your new
   repository.
5. In the build settings:
   - **Project name:** `memorybridge` (this becomes your web address)
   - **Framework preset:** None
   - **Build command:** leave empty
   - **Build output directory:** `/`
6. Click **Save and Deploy**. After ~30 seconds your site is live at
   `https://memorybridge.pages.dev` (or your chosen name).

Alternative without GitHub: in the same **Create → Pages** screen choose the
**Direct Upload** tab and drag the `memorybridge` folder in.

## Installing on an iPhone (Safari → Home Screen)

1. Open the deployed address (e.g. `https://memorybridge.pages.dev`) in
   **Safari** on the iPhone. (Chrome on iOS will not show the install option
   reliably — use Safari.)
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Check the name ("MemoryBridge") and tap **Add**.

MemoryBridge now appears on the Home Screen with its own golden-heart icon
and opens full-screen like a normal app — without Safari's address bar.
It also keeps working without internet, because the service worker caches
the app itself (never your private photos or recordings).

## iPhone notes

- **Microphone**: the first time you record, Safari asks for permission —
  tap **Allow**. If you tapped "Don't Allow", go to Settings → Safari →
  Microphone (or Settings → the app, once installed) and enable it.
- **Voice recording format**: iPhone Safari records in its own supported
  format; the app plays whatever it records without issue.
- **Video export**: the app checks which video format your browser can
  actually encode before recording. iPhone Safari produces MP4; other
  browsers may produce WebM. There is no guessing — unsupported browsers
  get a clear message instead of a broken file.
- **Sharing**: on iPhone, "Share with Family" opens the standard iOS share
  sheet, where you can pick WhatsApp, Messages, Mail, and anything else
  installed. Sharing only counts as done when iOS confirms it.

## How to test

1. **Home** — you should see two very large cards. Click either one to navigate.
   The top navigation buttons (Home / Talking Photos / Birthday Video) also work,
   and the browser back button returns to the previous view.
2. **Talking Photos**
   - Tap the upload area (or drag a photo onto it) and pick a real photo from
     your device. A large preview appears.
   - **Record Voice** asks for microphone permission (a clear message explains
     what to do if it is blocked), pulses red while recording, and shows a
     player with your recording when you stop.
   - **Upload Audio** links an MP3/WAV/M4A file to the photo and shows a player.
   - **Type a Story** opens a text box; press **Save Story** to keep it on this
     device (localStorage), or **Read Aloud** to hear it spoken. The same story
     reappears if you reload and pick a photo with the same file name.
   - **Play Memory** shows the photo full-size and plays the recorded or
     uploaded audio — or reads the story aloud when there is no audio.
   - **Download Memory** turns the photo plus its sound into a real video
     file (WebM, or MP4 where the browser truly supports MP4 encoding) with
     a progress bar, then saves it to your downloads.
   - **Share with Family** makes the same video and opens the device's
     native share menu (WhatsApp, Messages, email — whatever is installed)
     using the Web Share API. On devices that cannot share files, it says so
     and points to Download Memory instead.
3. **Birthday Video Maker**
   - Choose several photos at once (or drag them in). Thumbnails appear; each
     has a ✕ to remove it, and there is a "Remove all photos" button.
   - Enter a name (e.g. "Grandma Rose") and a birthday message.
   - Choose how long each photo stays on screen (3 / 5 / 8 seconds).
   - Press **Play Slideshow** — photos cycle with a crossfade-in, the name and
     message shown as a caption, and a progress bar on top. It loops until you
     press **Stop**.
   - Video file export is *not implemented yet* (shown as "Coming soon").

## What is implemented vs. planned

| Feature | Status |
|---|---|
| Layout, navigation, responsive design | ✅ Done |
| Photo upload + preview (Talking Photos) | ✅ Done |
| Type a Story + local save + Read Aloud | ✅ Done |
| Record Voice (MediaRecorder) + replay | ✅ Done |
| Upload Audio + replay | ✅ Done |
| Play Memory (audio or spoken story) | ✅ Done |
| Download Memory (photo + voice → video file) | ✅ Done |
| Share with Family (Web Share API) | ✅ Done |
| Multi-photo upload + slideshow preview | ✅ Done |
| Export slideshow as a video file | 🔜 Next step |

## Project structure

```
memorybridge/
├── index.html              # all three views (single-page app)
├── manifest.webmanifest    # PWA manifest (name, icons, standalone)
├── sw.js                   # service worker — caches ONLY static shell files
├── css/style.css           # warm styling + responsive/iPhone safe-area rules
├── js/
│   ├── app.js              # hash-based navigation between views
│   ├── storage.js          # tiny localStorage helper for stories
│   ├── video-export.js     # photo + audio → video (probed MP4/WebM)
│   ├── talking.js          # Talking Photos module
│   └── birthday.js         # Birthday module (multi-upload, slideshow preview)
├── icons/
│   ├── icon-192.png        # PWA / home-screen icon
│   └── icon-512.png        # PWA splash / maskable icon
├── test-slideshow.html     # dev-only harnesses (safe to delete)
└── test-talking.html
```

Each feature is an isolated module (`TalkingPhotos`, `BirthdayMaker`), so voice
recording (MediaRecorder), audio upload, and video exporting can be added
later without touching the layout.
