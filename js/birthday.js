/* ============================================================
   birthday.js — "Birthday Video Maker" view.

   Implemented:
     - multi-photo upload (3–10), preview, reorder (↑/↓), remove,
       remove-all
     - recipient name, birthday message, three readable themes
     - optional voice message: microphone recording or audio upload
     - canvas-rendered slideshow with crossfade transitions and
       large captions; preview and exported video use the SAME
       renderer
     - slideshow timing syncs to the narration length when a voice
       message exists (photos split evenly), otherwise uses the
       chosen seconds-per-photo
     - Play / Pause / Restart
     - Download Video and Share with Family, reusing the proven
       VideoExporter + Web Share pipeline from Talking Photos

   Everything stays on the device.
   ============================================================ */

const BirthdayMaker = (() => {
  const MAX_PHOTOS = 10;
  const MIN_PHOTOS = 3;
  const FADE_SECONDS = 0.8;

  // Theme palettes: bg gradient, caption panel, text colors.
  const THEMES = {
    cream: { top: '#fdf6ec', bottom: '#f3ddc4', text: '#3d2c1e', accent: '#c2571f', dark: false },
    gold:  { top: '#2a1c10', bottom: '#4a3016', text: '#fff8ef', accent: '#e9a319', dark: true },
    garden:{ top: '#eef4e4', bottom: '#cfe3bd', text: '#2c3a22', accent: '#3d6b4f', dark: false }
  };

  let photos = [];        // [{ src, name, img (Image), loaded }]
  let audioSource = null; // 'recorded' | 'uploaded'
  let audioBlobUrl = null;
  let audioFileName = '';
  let audioDuration = 0;  // seconds, known once decoded

  // playback state
  let playing = false;
  let paused = false;
  let rafId = null;
  let playToken = 0;      // invalidates stale animation loops

  // export state
  let exporting = false;

  const els = {};

  function init() {
    Object.assign(els, {
      zone: document.getElementById('bv-upload-zone'),
      fileInput: document.getElementById('bv-file-input'),
      thumbList: document.getElementById('bv-thumb-list'),
      emptyHint: document.getElementById('bv-empty-hint'),
      clearBtn: document.getElementById('bv-clear-photos'),
      photoStatus: document.getElementById('bv-photo-status'),
      name: document.getElementById('bv-name'),
      message: document.getElementById('bv-message'),
      theme: document.getElementById('bv-theme'),
      duration: document.getElementById('bv-duration'),
      recordBtn: document.getElementById('bv-record-btn'),
      uploadAudioBtn: document.getElementById('bv-upload-audio-btn'),
      audioInput: document.getElementById('bv-audio-input'),
      audioStatus: document.getElementById('bv-audio-status'),
      audioPreview: document.getElementById('bv-audio-preview'),
      audioLabel: document.getElementById('bv-audio-label'),
      audioPlayer: document.getElementById('bv-audio-player'),
      playBtn: document.getElementById('bv-play'),
      pauseBtn: document.getElementById('bv-pause'),
      restartBtn: document.getElementById('bv-restart'),
      status: document.getElementById('bv-slideshow-status'),
      stage: document.getElementById('bv-stage'),
      canvas: document.getElementById('bv-canvas'),
      downloadBtn: document.getElementById('bv-download-btn'),
      shareBtn: document.getElementById('bv-share-btn'),
      exportProgress: document.getElementById('bv-export-progress'),
      exportBar: document.getElementById('bv-export-bar'),
      exportStatus: document.getElementById('bv-export-status')
    });

    /* ----- photo upload ----- */
    els.zone.addEventListener('click', () => els.fileInput.click());
    els.zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.fileInput.click();
      }
    });
    els.fileInput.addEventListener('change', () => {
      addFiles(els.fileInput.files);
      els.fileInput.value = '';
    });
    ['dragover', 'dragenter'].forEach((ev) =>
      els.zone.addEventListener(ev, (e) => {
        e.preventDefault();
        els.zone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      els.zone.addEventListener(ev, (e) => {
        e.preventDefault();
        els.zone.classList.remove('dragover');
      })
    );
    els.zone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    els.clearBtn.addEventListener('click', clearPhotos);

    /* ----- voice message ----- */
    els.recordBtn.addEventListener('click', toggleRecording);
    els.uploadAudioBtn.addEventListener('click', () => els.audioInput.click());
    els.audioInput.addEventListener('change', handleAudioUpload);

    /* ----- playback controls ----- */
    els.playBtn.addEventListener('click', play);
    els.pauseBtn.addEventListener('click', togglePause);
    els.restartBtn.addEventListener('click', restart);

    /* ----- export / share ----- */
    els.downloadBtn.addEventListener('click', downloadVideo);
    els.shareBtn.addEventListener('click', shareVideo);

    /* ----- save / resume project ----- */
    els.saveBtn = document.getElementById('bv-save-btn');
    els.saveFinishedBtn = document.getElementById('bv-save-finished-btn');
    els.saveStatus = document.getElementById('bv-save-status');
    els.saveBtn.addEventListener('click', saveProject);
    els.saveFinishedBtn.addEventListener('click', saveFinishedMemory);

    /* ----- birthday wish helper ----- */
    els.wishOpenBtn = document.getElementById('bv-wish-open-btn');
    els.wishPanel = document.getElementById('bv-wish-panel');
    els.wishGenerateBtn = document.getElementById('wish-generate-btn');
    els.wishStatus = document.getElementById('wish-status');
    els.wishSuggestions = document.getElementById('wish-suggestions');
    els.wishOptions = document.getElementById('wish-options');
    els.wishOpenBtn.addEventListener('click', toggleWishPanel);
    els.wishGenerateBtn.addEventListener('click', generateWishes);
  }

  /* ================= status helpers ================= */

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle('error', isError);
  }
  function setAudioStatus(text, isError = false) {
    els.audioStatus.textContent = text;
    els.audioStatus.classList.toggle('error', isError);
  }
  function setExportStatus(text, isError = false) {
    els.exportStatus.textContent = text;
    els.exportStatus.classList.toggle('error', isError);
  }

  /* ================= photo management ================= */

  function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setPhotoStatus(`You can use up to ${MAX_PHOTOS} photos. Remove one to add another.`, true);
      return;
    }
    if (files.length > room) {
      setPhotoStatus(`Only ${room} more photo${room === 1 ? '' : 's'} fit — the extra ones were not added.`, true);
    }

    files.slice(0, room).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          photos.push({ src: reader.result, name: file.name, img, loaded: true });
          renderThumbs();
        };
        img.onerror = () => setPhotoStatus('One picture could not be opened and was skipped.', true);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function setPhotoStatus(text, isError = false) {
    els.photoStatus.textContent = text;
    els.photoStatus.classList.toggle('error', isError);
  }

  function renderThumbs() {
    els.thumbList.innerHTML = '';
    photos.forEach((photo, i) => {
      const li = document.createElement('li');
      li.className = 'thumb-item';

      const img = document.createElement('img');
      img.src = photo.src;
      img.alt = `Photo ${i + 1} of ${photos.length}`;

      const controls = document.createElement('div');
      controls.className = 'thumb-controls';

      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.setAttribute('aria-label', `Move photo ${i + 1} earlier`);
      up.disabled = i === 0;
      up.addEventListener('click', () => movePhoto(i, -1));

      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.setAttribute('aria-label', `Move photo ${i + 1} later`);
      down.disabled = i === photos.length - 1;
      down.addEventListener('click', () => movePhoto(i, 1));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'thumb-remove';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove photo ${i + 1}`);
      remove.addEventListener('click', () => {
        photos.splice(i, 1);
        renderThumbs();
      });

      controls.append(up, down, remove);
      li.append(img, controls);
      els.thumbList.appendChild(li);
    });

    const empty = photos.length === 0;
    els.emptyHint.hidden = !empty;
    els.clearBtn.hidden = empty;
    if (photos.length > 0 && photos.length < MIN_PHOTOS) {
      setPhotoStatus(`Choose ${MIN_PHOTOS - photos.length} more photo${MIN_PHOTOS - photos.length === 1 ? '' : 's'} to make a slideshow.`, true);
    } else if (photos.length >= MIN_PHOTOS) {
      setPhotoStatus(`${photos.length} photos ready. Use the arrows to put them in your favorite order.`);
    } else {
      setPhotoStatus('');
    }
  }

  function movePhoto(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= photos.length) return;
    [photos[i], photos[j]] = [photos[j], photos[i]];
    renderThumbs();
  }

  function clearPhotos() {
    photos = [];
    renderThumbs();
    setStatus('All photos were removed.');
    stopPlayback();
  }

  /* ================= voice message ================= */

  let recorder = null;
  let recordedChunks = [];
  let recordStream = null;

  async function toggleRecording() {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setAudioStatus('Sorry, this browser cannot record sound. Try Chrome, Edge, or Safari.', true);
      return;
    }
    try {
      setAudioStatus('Asking for the microphone…');
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setAudioStatus('The microphone was blocked. Please allow microphone access and try again.', true);
      } else if (err && err.name === 'NotFoundError') {
        setAudioStatus('No microphone was found on this device.', true);
      } else {
        setAudioStatus('The microphone could not be started. Please try again.', true);
      }
      return;
    }

    recordedChunks = [];
    recorder = new MediaRecorder(recordStream);
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    });
    recorder.addEventListener('stop', () => {
      recordStream.getTracks().forEach((t) => t.stop());
      recordStream = null;
      els.recordBtn.textContent = '🎙️ Record Voice Message';
      if (!recordedChunks.length) {
        setAudioStatus('Nothing was recorded. Please try again.', true);
        return;
      }
      const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
      attachAudio(blob, 'your voice message');
      setAudioStatus('Your voice message is ready. The slideshow will match its length.');
    });
    recorder.start();
    els.recordBtn.textContent = '⏹️ Stop Recording';
    els.recordBtn.classList.add('record-pulse');
    setAudioStatus('🔴 Recording… Speak your birthday message, then press "Stop Recording".');
  }

  function handleAudioUpload() {
    const file = els.audioInput.files[0];
    els.audioInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setAudioStatus('That file is not a sound file. Please choose an MP3, WAV, or M4A file.', true);
      return;
    }
    attachAudio(file, file.name);
    setAudioStatus(`"${file.name}" is now the birthday narration.`);
  }

  function attachAudio(source, label) {
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    audioBlobUrl = URL.createObjectURL(source);
    audioFileName = label;
    audioSource = 'recorded';

    els.audioPlayer.src = audioBlobUrl;
    els.audioLabel.textContent = label === 'your voice message'
      ? '🎙️ Your voice message:'
      : `🎵 Narration audio: ${label}`;
    els.audioPreview.hidden = false;
    els.audioPlayer.onloadedmetadata = () => {
      audioDuration = Number.isFinite(els.audioPlayer.duration) ? els.audioPlayer.duration : 0;
    };
  }

  /* ================= slideshow timing ================= */

  /**
   * Total show length. With narration: the narration length (photos split
   * evenly across it). Without: photos × chosen seconds per photo.
   */
  function showDuration(narrationSeconds) {
    if (narrationSeconds > 0) return narrationSeconds;
    return photos.length * Number(els.duration.value);
  }

  async function getNarrationSeconds() {
    if (!audioBlobUrl) return 0;
    try {
      const blob = await fetch(audioBlobUrl).then((r) => r.blob());
      const buf = await blob.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      ctx.close();
      return decoded.duration;
    } catch {
      return 0; // undecodable → fall back to timed slideshow
    }
  }

  /* ================= canvas rendering (preview == export) ================= */

  function drawFrame(ctx, W, H, state) {
    const theme = THEMES[els.theme.value] || THEMES.cream;

    // background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.top);
    grad.addColorStop(1, theme.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const { prev, current, fade } = state; // fade: 0..1 within transition
    if (current) drawPhotoContained(ctx, W, H, current.img);
    if (prev && fade > 0) {
      ctx.save();
      ctx.globalAlpha = 1 - fade;   // crossfade: previous photo fades out
      drawPhotoContained(ctx, W, H, prev.img);
      ctx.restore();
    }

    // large readable caption band
    const name = els.name.value.trim();
    const message = els.message.value.trim();
    if (name || message) {
      const bandH = Math.round(H * 0.22);
      const g2 = ctx.createLinearGradient(0, H - bandH * 1.5, 0, H);
      g2.addColorStop(0, 'rgba(20,10,2,0)');
      g2.addColorStop(0.5, theme.dark ? 'rgba(20,10,2,0.75)' : 'rgba(20,10,2,0.62)');
      g2.addColorStop(1, theme.dark ? 'rgba(20,10,2,0.85)' : 'rgba(20,10,2,0.72)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, H - bandH * 1.5, W, bandH * 1.5);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      if (name) {
        ctx.font = `bold ${Math.round(H * 0.075)}px Georgia, serif`;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.fillText(name, W / 2, H - bandH * 0.62, W * 0.9);
        ctx.shadowBlur = 0;
      }
      if (message) {
        ctx.font = `${Math.round(H * 0.045)}px Georgia, serif`;
        ctx.fillStyle = theme.accent === '#e9a319' ? '#ffe9b3' : '#ffe9d6';
        wrapText(ctx, message, W / 2, H - bandH * 0.18, W * 0.86, Math.round(H * 0.055), Math.round(H * 0.05));
      }
    }
  }

  function drawPhotoContained(ctx, W, H, img) {
    const scale = Math.min(W / img.width, H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }

  function wrapText(ctx, text, x, y, maxWidth, lineH, maxLines = 2) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length === maxLines) break;
      } else {
        line = test;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    const startY = y - (lines.length - 1) * lineH;
    lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineH));
  }

  /** Advance the slideshow state. Returns {prev, current, fade}. */
  function stateAtTime(t, perPhoto) {
    // t in [0, total]; each photo shows perPhoto seconds, with a
    // FADE_SECONDS crossfade straddling each boundary.
    const idx = Math.min(photos.length - 1, Math.floor(t / perPhoto));
    const local = t - idx * perPhoto;
    let prev = null, fade = 0;
    if (idx > 0 && local < FADE_SECONDS) {
      prev = photos[idx - 1];
      fade = local / FADE_SECONDS;
    }
    return { prev, current: photos[idx], fade };
  }

  /* ================= playback ================= */

  let pausedElapsed = 0;   // slideshow time (s) frozen at pause

  async function play() {
    if (playing) return;
    if (photos.length < MIN_PHOTOS) {
      setStatus(`Please choose at least ${MIN_PHOTOS} photos first.`, true);
      return;
    }

    // Narration (if any) starts with the slideshow; its length drives timing.
    let narrationSeconds = 0;
    if (audioBlobUrl) {
      els.audioPlayer.currentTime = 0;
      els.audioPlayer.play().catch(() => setAudioStatus('The narration could not be played.', true));
      narrationSeconds = await getNarrationSeconds();
    }

    pausedElapsed = 0;
    runLoop(narrationSeconds);
  }

  /**
   * One animation loop from `startElapsed` seconds. Reading narration length
   * up front keeps photo timing stable across pause/resume.
   */
  function runLoop(narrationSeconds, startElapsed = 0) {
    const total = showDuration(narrationSeconds);
    const perPhoto = total / photos.length;
    const ctx = els.canvas.getContext('2d');
    const W = els.canvas.width, H = els.canvas.height;
    const token = ++playToken;
    const anchor = performance.now() - startElapsed * 1000;
    playing = true;
    els.stage.hidden = false;
    setStatus('');

    const loop = () => {
      if (token !== playToken) return;       // superseded by stop/pause/restart
      const t = (performance.now() - anchor) / 1000;
      lastElapsed = Math.min(t, total);

      if (t >= total) {                      // finished one pass
        drawFrame(ctx, W, H, stateAtTime(total - 0.001, perPhoto));
        playing = false;
        paused = false;
        lastElapsed = 0;
        if (!els.audioPlayer.paused) els.audioPlayer.pause();
        setStatus('The slideshow finished. Press Restart to watch again. 💛');
        return;
      }
      drawFrame(ctx, W, H, stateAtTime(t, perPhoto));
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!playing) return;
    const ctx = els.canvas.getContext('2d');
    if (!paused) {
      // freeze: remember time, stop raf + narration
      paused = true;
      playToken++;              // stops the running loop
      cancelAnimationFrame(rafId);
      if (!els.audioPlayer.paused) els.audioPlayer.pause();
      setStatus('Paused. Press Pause again to continue.');
    } else {
      // resume from the frozen position
      paused = false;
      setStatus('');
      const narrationSeconds = audioBlobUrl ? (audioDuration || getNarrationSecondsSync()) : 0;
      if (audioBlobUrl && els.audioPlayer.paused) {
        // keep narration roughly in sync with the frozen frame
        const total = showDuration(narrationSeconds);
        els.audioPlayer.currentTime = Math.min(
          els.audioPlayer.duration || Infinity,
          (lastElapsed / total) * (els.audioPlayer.duration || 0)
        );
        els.audioPlayer.play().catch(() => {});
      }
      runLoop(narrationSeconds, lastElapsed);
    }
  }

  /** Fallback when metadata never loaded: estimate from file playback. */
  function getNarrationSecondsSync() {
    return Number.isFinite(els.audioPlayer.duration) ? els.audioPlayer.duration : 0;
  }

  function restart() {
    stopPlayback();
    play();
  }

  function stopPlayback() {
    playToken++;               // invalidates any running animation loop
    playing = false;
    paused = false;
    cancelAnimationFrame(rafId);
    if (!els.audioPlayer.paused) els.audioPlayer.pause();
    els.stage.hidden = true;
    lastElapsed = 0;
    pausedElapsed = 0;
  }

  /* ================= export + share (reuses VideoExporter) ================= */

  function setExportProgress(fraction) {
    els.exportProgress.hidden = false;
    els.exportBar.style.width = `${Math.round(fraction * 100)}%`;
  }
  function hideExportProgress() {
    els.exportProgress.hidden = true;
    els.exportBar.style.width = '0';
  }

  /**
   * Render the slideshow frames onto an offscreen canvas and record it with
   * the narration through the shared VideoExporter recorder path.
   */
  async function renderVideo() {
    if (photos.length < MIN_PHOTOS) {
      setExportStatus(`Please choose at least ${MIN_PHOTOS} photos first.`, true);
      return null;
    }

    exporting = true;
    els.downloadBtn.disabled = true;
    els.shareBtn.disabled = true;
    setExportStatus('Making your video…');

    try {
      const mimeType = VideoExporter.pickMimeType();
      if (!mimeType) {
        throw new Error('Sorry, this browser cannot make videos. On iPhone, please update to the latest iOS and try again.');
      }

      // narration audio blob
      let audioBlob = null, narrationSeconds = 0;
      if (audioBlobUrl) {
        audioBlob = await fetch(audioBlobUrl).then((r) => r.blob());
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const probe = new AudioCtx();
        const decoded = await probe.decodeAudioData(await audioBlob.arrayBuffer().then((b) => b.slice(0)));
        narrationSeconds = decoded.duration;
        probe.close();
      }

      const total = showDuration(narrationSeconds);
      const perPhoto = total / photos.length;

      // offscreen render canvas
      const W = 1280, H = 800;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      drawFrame(ctx, W, H, stateAtTime(0, perPhoto));
      const stream = canvas.captureStream(30);

      // audio track via Web Audio (same approach as VideoExporter)
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const dest = audioCtx.createMediaStreamDestination();
      let source = null;
      if (audioBlob) {
        const decoded = await audioCtx.decodeAudioData(await audioBlob.arrayBuffer().then((b) => b.slice(0)));
        source = audioCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(dest);
      }
      const combined = new MediaStream([
        ...stream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combined, { mimeType });
      const chunks = [];
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      });
      const done = new Promise((resolve, reject) => {
        recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })));
        recorder.addEventListener('error', () => reject(new Error('Recording failed while making the video.')));
      });

      recorder.start(250);
      if (source) source.start();

      const startedAt = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const t = (performance.now() - startedAt) / 1000;
          if (t >= total) { resolve(); return; }
          drawFrame(ctx, W, H, stateAtTime(t, perPhoto));
          setExportProgress(Math.min(0.99, t / total));
          requestAnimationFrame(tick);
        };
        tick();
        // safety net
        setTimeout(resolve, (total + 3) * 1000);
      });

      await new Promise((r) => setTimeout(r, 300));
      if (recorder.state !== 'inactive') recorder.stop();
      const blob = await done;

      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close();
      hideExportProgress();
      setExportProgress(1);

      if (!blob || blob.size === 0) {
        throw new Error('The video came out empty. Please try again.');
      }
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      setExportStatus('Your video is ready! 💛');
      return { blob, ext, mimeType };
    } catch (err) {
      hideExportProgress();
      setExportStatus(err.message || 'The video could not be made on this device.', true);
      return null;
    } finally {
      exporting = false;
      els.downloadBtn.disabled = false;
      els.shareBtn.disabled = false;
    }
  }

  function downloadFile(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function downloadVideo() {
    const video = await renderVideo();
    if (!video) return;
    downloadFile(new File([video.blob], `birthday-video-${Date.now()}.${video.ext}`, { type: video.mimeType }));
    setExportStatus('Your birthday video was saved to your downloads. 💛');
  }

  async function shareVideo() {
    if (!navigator.share || !navigator.canShare) {
      setExportStatus('This device cannot share files directly. Saving the video for you instead…');
      return downloadVideo();
    }
    const video = await renderVideo();
    if (!video) return;
    const file = new File([video.blob], `birthday-video.${video.ext}`, { type: video.mimeType });
    if (!navigator.canShare({ files: [file] })) {
      setExportStatus('This device cannot share video files. Saving the video for you instead…');
      return downloadFile(file);
    }
    try {
      await navigator.share({ files: [file], title: 'Happy Birthday!' });
      setExportStatus('Your birthday video was shared. 💛');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        setExportStatus('Sharing was cancelled.');
      } else {
        setExportStatus('Sharing did not go through. Saving the video for you instead…');
        downloadFile(file);
      }
    }
  }

  /* ================= Save / resume project (IndexedDB) ================= */

  async function collectProjectData() {
    const photoBlobs = [];
    for (const photo of photos) {
      photoBlobs.push(await (await fetch(photo.src)).blob());
    }
    const audioBlob = audioBlobUrl ? await fetch(audioBlobUrl).then((r) => r.blob()) : null;
    return {
      photoBlobs,
      photoNames: photos.map((p) => p.name),
      audioBlob,
      settings: {
        name: els.name.value.trim(),
        message: els.message.value.trim(),
        theme: els.theme.value,
        secondsPerPhoto: els.duration.value
      }
    };
  }

  async function saveProject() {
    if (photos.length === 0) {
      els.saveStatus.textContent = 'Choose some photos before saving the project.';
      els.saveStatus.classList.add('error');
      return;
    }
    els.saveBtn.disabled = true;
    els.saveStatus.classList.remove('error');
    els.saveStatus.textContent = 'Saving your project…';
    try {
      const data = await collectProjectData();
      await MemoryDB.saveProject({
        title: data.settings.name || 'Birthday project',
        ...data
      });
      els.saveStatus.textContent = 'Project saved! Find it under My Memories — open it to keep editing. 💛';
    } catch (err) {
      els.saveStatus.textContent = MemoryDB.friendlyError(err);
      els.saveStatus.classList.add('error');
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  /** Save the currently loaded content as a finished Talking-Photos-style memory. */
  async function saveFinishedMemory() {
    if (photos.length < MIN_PHOTOS) {
      els.saveStatus.textContent = `Please choose at least ${MIN_PHOTOS} photos before saving a finished memory.`;
      els.saveStatus.classList.add('error');
      return;
    }
    els.saveFinishedBtn.disabled = true;
    els.saveStatus.classList.remove('error');
    els.saveStatus.textContent = 'Saving…';
    try {
      const data = await collectProjectData();
      await MemoryDB.saveProject({
        title: `Birthday for ${data.settings.name || 'someone special'} ✓`,
        ...data
      });
      els.saveStatus.textContent = 'Saved under My Memories. 💛';
    } catch (err) {
      els.saveStatus.textContent = MemoryDB.friendlyError(err);
      els.saveStatus.classList.add('error');
    } finally {
      els.saveFinishedBtn.disabled = false;
    }
  }

  /* ================= Birthday Wish Helper ================= */

  function toggleWishPanel() {
    const showing = els.wishPanel.hidden;
    els.wishPanel.hidden = !showing;
    if (showing) {
      // pre-fill the recipient from the slideshow name field
      const recipientInput = document.getElementById('wish-recipient');
      if (!recipientInput.value && els.name.value.trim()) {
        recipientInput.value = els.name.value.trim();
      }
    }
  }

  function wishReadAloud(text, langCode) {
    if (!('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode === 'ms' ? 'ms-MY' : langCode === 'zh' ? 'zh-CN' : 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  async function generateWishes() {
    const profile = {
      recipient: document.getElementById('wish-recipient').value.trim(),
      relationship: document.getElementById('wish-relationship').value,
      language: document.getElementById('wish-language').value,
      tone: document.getElementById('wish-tone').value
    };

    els.wishGenerateBtn.disabled = true;
    els.wishStatus.classList.remove('error');
    els.wishStatus.textContent = 'Writing your wishes…';

    const { suggestions, source } = await WishAssistant.generate(profile);

    els.wishGenerateBtn.disabled = false;
    els.wishStatus.textContent = source === 'ai'
      ? 'Suggestions written for you:'
      : 'Suggestions from our built-in templates (not AI). Pick one below:';
    if (source === 'template') {
      els.wishStatus.textContent += ' Nothing was sent to the internet.';
    }

    els.wishSuggestions.hidden = false;
    els.wishOptions.innerHTML = '';

    suggestions.forEach((text) => {
      const option = document.createElement('div');
      option.className = 'wish-option';

      const wishText = document.createElement('p');
      wishText.className = 'wish-option-text';
      wishText.textContent = text;

      const row = document.createElement('div');
      row.className = 'btn-row';

      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn btn-primary';
      use.textContent = '✓ Use This Wish';
      use.addEventListener('click', () => {
        els.message.value = text;
        els.wishStatus.textContent = 'Your wish was placed in the birthday message box. You can still edit it there. 💛';
      });

      const read = document.createElement('button');
      read.type = 'button';
      read.className = 'btn btn-secondary';
      read.textContent = '🔊 Read Aloud';
      read.addEventListener('click', () => {
        if (wishReadAloud(text, profile.language)) {
          els.wishStatus.textContent = 'Reading the wish aloud…';
        } else {
          els.wishStatus.textContent = 'This browser cannot read text aloud.';
          els.wishStatus.classList.add('error');
        }
      });

      row.append(use, read);
      option.append(wishText, row);
      els.wishOptions.appendChild(option);
    });
  }

  /**
   * Resume a saved project: restore photos, audio, and every setting.
   * Called from the My Memories view.
   */
  function loadProject(record) {
    stopPlayback();
    photos = [];
    let pending = record.photoBlobs.length;
    setPhotoStatus('Loading your project…');

    record.photoBlobs.forEach((blob, i) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        photos.push({ src: url, name: record.photoNames[i] || `photo-${i + 1}`, img, loaded: true });
        if (--pending === 0) {
          // restore original order (IndexedDB array order is preserved)
          photos.sort((a, b) => {
            const ai = record.photoNames.indexOf(a.name);
            const bi = record.photoNames.indexOf(b.name);
            return ai - bi;
          });
          renderThumbs();
          setPhotoStatus('Your project is ready to continue. 💛');
        }
      };
      img.src = url;
    });

    if (record.audioBlob) {
      attachAudio(record.audioBlob, record.audioKind === 'recorded' ? 'your voice message' : 'saved narration');
      audioSource = 'recorded';
    } else {
      audioBlobUrl = null;
      audioSource = null;
      els.audioPreview.hidden = true;
    }

    const s = record.settings || {};
    els.name.value = s.name || '';
    els.message.value = s.message || '';
    if (s.theme) els.theme.value = s.theme;
    if (s.secondsPerPhoto) els.duration.value = s.secondsPerPhoto;
  }

  // Dev-only hooks used by the test harness; not used by the app UI.
  return { init, loadProject, _testAddFiles: addFiles, _renderVideo: renderVideo, _stateAtTime: stateAtTime };
})();
