/* ============================================================
   talking.js — "Talking Photos" view.

   Implemented:
     - photo upload + preview (file picker & drag-and-drop)
     - Record Voice: MediaRecorder with mic permission handling,
       start/stop, and in-page replay of the recording
     - Upload Audio: link an audio file (MP3/WAV/M4A/…) to the photo
     - Type a Story: text saved locally + Read Aloud (SpeechSynthesis)
     - Play Memory: shows the photo and plays attached audio, or
       reads the saved story aloud when there is no audio

   Everything stays on the device. Recorded audio and uploaded
   audio live in memory for this session; the written story is
   kept in localStorage.
   ============================================================ */

const TalkingPhotos = (() => {
  let currentPhoto = null;      // { src, name }
  let audioSource = null;       // 'recorded' | 'uploaded'
  let audioBlobUrl = null;      // object URL for the <audio> element
  let audioFileName = '';
  let recorder = null;          // MediaRecorder instance
  let recordedChunks = [];      // incoming Blob parts while recording
  let recordStream = null;      // mic stream, stopped after recording
  let exporting = false;        // true while a video is being built

  const els = {};

  function init() {
    Object.assign(els, {
      zone: document.getElementById('tp-upload-zone'),
      fileInput: document.getElementById('tp-file-input'),
      previewArea: document.getElementById('tp-preview-area'),
      previewImg: document.getElementById('tp-photo-preview'),
      changePhoto: document.getElementById('tp-change-photo'),
      actionsPanel: document.getElementById('tp-actions-panel'),
      recordBtn: document.getElementById('tp-record-btn'),
      uploadAudioBtn: document.getElementById('tp-upload-audio-btn'),
      audioInput: document.getElementById('tp-audio-input'),
      typeStoryBtn: document.getElementById('tp-type-story-btn'),
      playBtn: document.getElementById('tp-play-btn'),
      memoryStatus: document.getElementById('tp-memory-status'),
      audioPreview: document.getElementById('tp-audio-preview'),
      audioLabel: document.getElementById('tp-audio-label'),
      audioPlayer: document.getElementById('tp-audio-player'),
      storyEditor: document.getElementById('tp-story-editor'),
      storyText: document.getElementById('tp-story-text'),
      saveStory: document.getElementById('tp-save-story'),
      readAloud: document.getElementById('tp-read-aloud'),
      stopReading: document.getElementById('tp-stop-reading'),
      storyStatus: document.getElementById('tp-story-status'),
      memoryStage: document.getElementById('tp-memory-stage'),
      memoryPhoto: document.getElementById('tp-memory-photo'),
      memoryCaption: document.getElementById('tp-memory-caption'),
      downloadBtn: document.getElementById('tp-download-btn'),
      shareBtn: document.getElementById('tp-share-btn'),
      exportProgress: document.getElementById('tp-export-progress'),
      exportBar: document.getElementById('tp-export-bar'),
      exportStatus: document.getElementById('tp-export-status')
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
      const file = els.fileInput.files[0];
      if (file) loadPhoto(file);
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
    els.zone.addEventListener('drop', (e) => {
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (file) loadPhoto(file);
    });
    els.changePhoto.addEventListener('click', () => els.fileInput.click());

    /* ----- the four memory buttons ----- */
    els.recordBtn.addEventListener('click', toggleRecording);
    els.uploadAudioBtn.addEventListener('click', () => els.audioInput.click());
    els.audioInput.addEventListener('change', handleAudioUpload);
    els.typeStoryBtn.addEventListener('click', toggleStoryEditor);
    els.playBtn.addEventListener('click', playMemory);

    /* ----- story editor ----- */
    els.saveStory.addEventListener('click', handleSaveStory);
    els.readAloud.addEventListener('click', () => speakStory(els.storyText.value));
    els.stopReading.addEventListener('click', stopSpeaking);

    /* ----- keep / share ----- */
    els.downloadBtn.addEventListener('click', downloadMemory);
    els.shareBtn.addEventListener('click', shareMemory);
    els.saveBtn = document.getElementById('tp-save-btn');
    els.saveStatus = document.getElementById('tp-save-status');
    els.saveBtn.addEventListener('click', saveToMemories);
  }

  /* ================= photo ================= */

  function loadPhoto(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      stopAllPlayback();
      currentPhoto = { src: reader.result, name: file.name };
      els.previewImg.src = currentPhoto.src;
      els.previewArea.hidden = false;
      els.zone.hidden = true;
      els.actionsPanel.hidden = false;
      // a new photo starts with no attached audio
      audioSource = null;
      audioBlobUrl = null;
      audioFileName = '';
      els.audioPreview.hidden = true;
      els.memoryStage.hidden = true;
      setMemoryStatus('');
      loadSavedStory();
    };
    reader.readAsDataURL(file);
  }

  function photoKey() {
    // Stories are remembered per photo name (simple local, single-device rule).
    return currentPhoto ? currentPhoto.name : '';
  }

  function loadSavedStory() {
    const saved = MemoryStore.getStory(photoKey());
    if (saved) {
      els.storyText.value = saved;
      els.storyStatus.textContent = 'We found your saved story for this photo.';
    }
  }

  /* ================= status helpers ================= */

  function setMemoryStatus(text, isError = false) {
    els.memoryStatus.textContent = text;
    els.memoryStatus.classList.toggle('error', isError);
  }

  /* ================= 1. Record Voice ================= */

  async function toggleRecording() {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    await startRecording();
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setMemoryStatus('Sorry, this browser cannot record sound. Try Chrome, Edge, or Safari.', true);
      return;
    }
    try {
      setMemoryStatus('Asking for the microphone…');
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setMemoryStatus('The microphone was blocked. Please allow microphone access in your browser settings, then try again.', true);
      } else if (err && err.name === 'NotFoundError') {
        setMemoryStatus('No microphone was found on this device.', true);
      } else {
        setMemoryStatus('The microphone could not be started. Please try again.', true);
      }
      return;
    }

    try {
      recordedChunks = [];
      recorder = new MediaRecorder(recordStream);
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      });
      recorder.addEventListener('stop', finishRecording);
      recorder.start();
    } catch (err) {
      releaseMic();
      setMemoryStatus('Recording could not start on this device.', true);
      return;
    }

    els.recordBtn.textContent = '⏹️ Stop Recording';
    els.recordBtn.classList.add('record-pulse');
    setMemoryStatus('🔴 Recording… Tell your memory, then press "Stop Recording".');
  }

  function finishRecording() {
    releaseMic();
    els.recordBtn.textContent = '🎙️ Record Voice';
    els.recordBtn.classList.remove('record-pulse');

    if (recordedChunks.length === 0) {
      setMemoryStatus('Nothing was recorded. Please try again.', true);
      return;
    }
    const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
    attachAudio(blob, 'your recording');
    setMemoryStatus('Your voice was recorded. Press ▶️ Play Memory to hear it with the photo.');
  }

  function releaseMic() {
    if (recordStream) {
      recordStream.getTracks().forEach((t) => t.stop());
      recordStream = null;
    }
  }

  /* ================= 2. Upload Audio ================= */

  function handleAudioUpload() {
    const file = els.audioInput.files[0];
    els.audioInput.value = '';
    if (!file) return;
    handleAudioFile(file);
  }

  function handleAudioFile(file) {
    if (!file.type.startsWith('audio/')) {
      setMemoryStatus('That file is not a sound file. Please choose an MP3, WAV, or M4A file.', true);
      return;
    }
    attachAudio(file, file.name);
    setMemoryStatus(`"${file.name}" is now linked to this photo.`);
  }

  /* ================= shared audio plumbing ================= */

  function attachAudio(source, label) {
    stopSpeaking();
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    audioBlobUrl = URL.createObjectURL(source);
    audioFileName = label;
    audioSource = 'recorded';

    els.audioPlayer.src = audioBlobUrl;
    els.audioLabel.textContent = label === 'your recording'
      ? '🎙️ Your recording for this photo:'
      : `🎵 Linked audio file: ${label}`;
    els.audioPreview.hidden = false;
    els.memoryStage.hidden = true;
  }

  /* ================= 3. Type a Story + Read Aloud ================= */

  function toggleStoryEditor() {
    const showing = els.storyEditor.hidden;
    els.storyEditor.hidden = !showing;
    if (showing) els.storyText.focus();
  }

  function handleSaveStory() {
    const text = els.storyText.value.trim();
    if (!text) {
      els.storyStatus.textContent = 'Please write a little story first.';
      els.storyStatus.classList.add('error');
      return;
    }
    els.storyStatus.classList.remove('error');
    MemoryStore.saveStory(photoKey(), text);
    els.storyStatus.textContent = 'Your story is saved on this device. ✓';
  }

  function speakStory(text) {
    if (!('speechSynthesis' in window)) {
      els.storyStatus.textContent = 'Sorry, this browser cannot read text aloud.';
      els.storyStatus.classList.add('error');
      return;
    }
    const trimmed = (text || '').trim();
    if (!trimmed) {
      els.storyStatus.textContent = 'Write (or load) a story first, then press Read Aloud.';
      els.storyStatus.classList.add('error');
      return;
    }
    els.storyStatus.classList.remove('error');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.rate = 0.9;   // a little slower, easier to follow
    utterance.lang = 'en-US';
    utterance.onend = () => {
      if (els.memoryStage.hidden === false && audioSource === 'story') {
        els.memoryStage.hidden = true;
      }
    };
    window.speechSynthesis.speak(utterance);
    els.storyStatus.textContent = 'Reading your story aloud…';
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /* ================= 4. Play Memory ================= */

  function playMemory() {
    if (!currentPhoto) return;
    stopAllPlayback();

    els.memoryPhoto.src = currentPhoto.src;
    els.memoryStage.hidden = false;

    if (audioSource && audioBlobUrl) {
      els.memoryCaption.textContent = `Listening to ${audioFileName}…`;
      els.audioPlayer.currentTime = 0;
      els.audioPlayer.play().catch(() => {
        setMemoryStatus('The sound could not be played. Please try again.', true);
      });
      els.audioPlayer.onended = () => {
        els.memoryCaption.textContent = 'The memory finished playing. 💛';
      };
    } else if (els.storyText.value.trim()) {
      audioSource = 'story';
      els.memoryCaption.textContent = 'Reading your story aloud…';
      speakStory(els.storyText.value);
    } else {
      els.memoryStage.hidden = true;
      setMemoryStatus('This photo has no sound yet. Record your voice or type a story first.', true);
    }
  }

  function stopAllPlayback() {
    stopSpeaking();
    if (!els.audioPlayer.paused) els.audioPlayer.pause();
  }

  /* ================= 5. Download / Share Memory ================= */

  /**
   * The audio attached to the photo lives in the <audio> element as a blob
   * URL. Re-fetch it as a Blob so the exporter can decode it. Returns null
   * when there is no audio.
   */
  async function getMemoryAudioBlob() {
    if (!audioBlobUrl) return null;
    const response = await fetch(audioBlobUrl);
    return response.blob();
  }

  function setExportStatus(text, isError = false) {
    els.exportStatus.textContent = text;
    els.exportStatus.classList.toggle('error', isError);
  }

  function setExportProgress(fraction) {
    els.exportProgress.hidden = false;
    els.exportBar.style.width = `${Math.round(fraction * 100)}%`;
  }

  function hideExportProgress() {
    els.exportProgress.hidden = true;
    els.exportBar.style.width = '0';
  }

  async function makeMemoryVideo() {
    if (exporting) return null;          // one export at a time
    if (!currentPhoto) {
      setExportStatus('Please choose a photo first.', true);
      return null;
    }
    const audioBlob = await getMemoryAudioBlob();
    if (!audioBlob) {
      setExportStatus('This photo has no sound yet. Record your voice or upload audio first.', true);
      return null;
    }

    exporting = true;
    els.downloadBtn.disabled = true;
    els.shareBtn.disabled = true;
    setExportStatus('Making your video… this takes about as long as the sound.');
    try {
      const result = await VideoExporter.exportVideo(currentPhoto.src, audioBlob, {
        onProgress: setExportProgress
      });
      hideExportProgress();
      setExportStatus('Your video is ready! 💛');
      return result;
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

  async function shareMemory() {
    if (!navigator.share || !navigator.canShare) {
      setExportStatus('This device cannot share files directly. Saving the video for you instead…');
      return downloadMemory();
    }
    const video = await makeMemoryVideo();
    if (!video) return;
    const file = new File([video.blob], `memory.${video.ext}`, { type: video.mimeType });
    if (!navigator.canShare({ files: [file] })) {
      setExportStatus('This device cannot share video files. Saving the video for you instead…');
      return downloadFile(file);
    }
    try {
      await navigator.share({ files: [file], title: 'My Memory' });
      // Only reached when the browser confirms the share sheet completed
      // without an abort — anything else lands in the catch below.
      setExportStatus('Your memory was shared. 💛');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        setExportStatus('Sharing was cancelled.');
      } else {
        setExportStatus('Sharing did not go through. Saving the video for you instead…');
        downloadFile(file);
      }
    }
  }

  /** Save an already-built video File to downloads (shared fallback path). */
  function downloadFile(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setExportStatus('Your video was saved to your downloads. You can send it to family from there. 💛');
  }

  async function downloadMemory() {
    const video = await makeMemoryVideo();
    if (!video) return;
    downloadFile(new File([video.blob], `memory-${Date.now()}.${video.ext}`, { type: video.mimeType }));
  }

  /* ================= Save to My Memories (IndexedDB) ================= */

  async function saveToMemories() {
    if (!currentPhoto) {
      els.saveStatus.textContent = 'Please choose a photo first.';
      els.saveStatus.classList.add('error');
      return;
    }
    els.saveBtn.disabled = true;
    els.saveStatus.classList.remove('error');
    els.saveStatus.textContent = 'Saving…';
    try {
      // Convert the photo data URL to a Blob for IndexedDB (blobs, not
      // localStorage, hold large media).
      const photoBlob = await (await fetch(currentPhoto.src)).blob();
      const audioBlob = await getMemoryAudioBlob();
      await MemoryDB.saveMemory({
        title: `Memory from ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        photoBlob,
        photoName: currentPhoto.name,
        audioBlob,
        audioKind: audioBlob ? (audioFileName === 'your recording' ? 'recorded' : 'uploaded') : null,
        story: els.storyText.value.trim()
      });
      els.saveStatus.textContent = 'Saved! Find it under My Memories. 💛';
    } catch (err) {
      els.saveStatus.textContent = MemoryDB.friendlyError(err);
      els.saveStatus.classList.add('error');
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  // Dev-only hooks used by test-talking.html; not used by the app UI.
  return { init, _testLoadPhoto: loadPhoto, _testAttachAudio: (f) => handleAudioFile(f), _makeMemoryVideo: makeMemoryVideo };
})();
