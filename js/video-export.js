/* ============================================================
   video-export.js — turns a photo + its audio into a real,
   downloadable video file, entirely in the browser.

   How it works:
     1. The photo is drawn on a <canvas>.
     2. canvas.captureStream() becomes the video track.
     3. The audio (recording or uploaded file) is decoded and
        played through Web Audio into a MediaStreamDestination,
        becoming the audio track.
     4. MediaRecorder records both tracks together into WebM
        (or MP4 where the browser genuinely supports it).
     5. When the audio ends, recording stops and the Blob is
        returned to the caller (download or Web Share).

   Nothing is uploaded anywhere: the whole pipeline lives in
   this browser tab.
   ============================================================ */

const VideoExporter = (() => {

  /** Find the best video mimetype this browser can actually encode.
   *  Never assumes MP4 or WebM — probes MediaRecorder support first.
   *  Safari/iPhone records MP4 (H.264/AAC); Chrome/Android often MP4 too;
   *  Firefox and older Chromium get WebM. */
  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // explicit H.264+AAC (iOS Safari)
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (const type of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch { /* keep probing */ }
    }
    return null;
  }

  function fileExtension(mimeType) {
    return mimeType.includes('mp4') ? 'mp4' : 'webm';
  }

  /**
   * Build a video from one photo and one audio source.
   * @param {string} photoSrc  data URL (or any img-loadable src) of the photo
   * @param {Blob}   audioBlob the memory audio
   * @param {object} handlers  { onProgress(0..1), log(msg) }
   * @returns {Promise<{blob: Blob, ext: string, mimeType: string}>}
   */
  async function exportVideo(photoSrc, audioBlob, handlers = {}) {
    const mimeType = pickMimeType();
    if (!mimeType) {
      throw new Error('Sorry, this browser cannot make videos. On iPhone, please update to the latest iOS and try again.');
    }
    handlers.log && handlers.log(`Recording video as ${mimeType.includes('mp4') ? 'MP4' : 'WebM'}…`);

    /* --- decode the audio so Web Audio can play it into the recorder --- */
    const arrayBuffer = await audioBlob.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

    /* --- canvas with the photo drawn letterboxed on a warm background --- */
    const img = await loadImage(photoSrc);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 1280;
    drawPhoto(canvas, img);

    const videoStream = canvas.captureStream(30);

    /* --- audio track --- */
    const dest = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(dest);

    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    const recorder = new MediaRecorder(combined, { mimeType });
    const chunks = [];
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });

    const durationMs = decoded.duration * 1000;
    const startedAt = Date.now();

    // Gently animate the canvas so the recorder keeps producing frames:
    // a very slow Ken Burns zoom plus a small animated progress dot.
    const drawLoop = setInterval(() => {
      drawPhoto(canvas, img, (Date.now() - startedAt) / durationMs);
      if (handlers.onProgress) {
        handlers.onProgress(Math.min(0.99, (Date.now() - startedAt) / durationMs));
      }
    }, 100);

    const done = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })));
      recorder.addEventListener('error', () => reject(new Error('Recording failed while making the video.')));
    });

    recorder.start(250);
    source.start();

    // Stop when the audio ends (plus a tiny tail so the last frames land).
    await new Promise((resolve) => {
      source.onended = resolve;
      // safety net: never record more than duration + 2 s
      setTimeout(resolve, durationMs + 2000);
    });

    await new Promise((r) => setTimeout(r, 300));
    if (recorder.state !== 'inactive') recorder.stop();

    const blob = await done;
    clearInterval(drawLoop);
    videoStream.getTracks().forEach((t) => t.stop());
    audioCtx.close();
    if (handlers.onProgress) handlers.onProgress(1);

    if (!blob || blob.size === 0) {
      throw new Error('The video came out empty. Please try again.');
    }
    return { blob, ext: fileExtension(mimeType), mimeType };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The photo could not be read.'));
      img.src = src;
    });
  }

  /** Draw the photo letterboxed, with an optional slow zoom for liveliness. */
  function drawPhoto(canvas, img, t = 0) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fdf6ec';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const zoom = 1 + 0.04 * Math.min(1, t);           // slow Ken Burns
    const scale = Math.min(
      (canvas.width * 0.94) / img.width,
      (canvas.height * 0.94) / img.height
    ) * zoom;
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  return { exportVideo, pickMimeType };
})();
