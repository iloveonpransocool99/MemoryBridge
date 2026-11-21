/* ============================================================
   memories.js — "My Memories" view.

   Shows everything saved in IndexedDB (from Talking Photos and
   Birthday projects) as large cards, and lets the user:
     - open / replay a memory (photo + audio + story, or project)
     - download its media
     - rename it
     - delete it (with a confirmation question first)

   All data stays in IndexedDB on this device.
   ============================================================ */

const MyMemories = (() => {
  let items = [];              // combined, sorted list for display
  let renameTarget = null;     // { kind, id }
  let viewerItem = null;

  const els = {};

  function init() {
    Object.assign(els, {
      list: document.getElementById('mm-card-list'),
      emptyHint: document.getElementById('mm-empty-hint'),
      usage: document.getElementById('mm-storage-usage'),
      viewer: document.getElementById('mm-viewer'),
      viewerTitle: document.getElementById('mm-viewer-title'),
      viewerPhoto: document.getElementById('mm-viewer-photo'),
      viewerStory: document.getElementById('mm-viewer-story'),
      viewerAudio: document.getElementById('mm-viewer-audio'),
      viewerDownload: document.getElementById('mm-viewer-download'),
      viewerClose: document.getElementById('mm-viewer-close'),
      renameDialog: document.getElementById('mm-rename-dialog'),
      renameInput: document.getElementById('mm-rename-input'),
      renameConfirm: document.getElementById('mm-rename-confirm'),
      renameCancel: document.getElementById('mm-rename-cancel')
    });

    els.viewerClose.addEventListener('click', closeViewer);
    els.viewerDownload.addEventListener('click', downloadViewerMedia);
    els.renameConfirm.addEventListener('click', confirmRename);
    els.renameCancel.addEventListener('click', hideRename);

    document.querySelectorAll('[data-nav="memories"]').forEach((btn) =>
      btn.addEventListener('click', () => refresh())
    );
  }

  /** Called whenever the view becomes visible. */
  async function refresh() {
    try {
      const [memories, projects] = await Promise.all([
        MemoryDB.getAllMemories(),
        MemoryDB.getAllProjects()
      ]);
      items = [
        ...memories.map((m) => ({ ...m, cardKind: 'memory' })),
        ...projects.map((p) => ({ ...p, cardKind: 'project' }))
      ].sort((a, b) => (b.updatedAt || b.createdAt) - (a.createdAt || b.createdAt));
    } catch (err) {
      items = [];
      els.usage.textContent = MemoryDB.friendlyError(err);
      els.usage.classList.add('error');
    }
    renderCards();
    renderUsage();
  }

  function renderUsage() {
    MemoryDB.estimate().then(({ usage, quota, supported }) => {
      if (!supported) {
        els.usage.textContent = `${items.length} saved item${items.length === 1 ? '' : 's'}.`;
        return;
      }
      const usedMB = (usage / (1024 * 1024)).toFixed(1);
      const quotaMB = Math.round(quota / (1024 * 1024));
      els.usage.classList.remove('error');
      els.usage.textContent =
        `${items.length} saved item${items.length === 1 ? '' : 's'} — using about ${usedMB} MB of roughly ${quotaMB} MB available on this device.`;
    });
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function renderCards() {
    els.list.innerHTML = '';
    els.emptyHint.hidden = items.length > 0;
    els.viewer.hidden = true;
    closeViewer();

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'memory-card';

      const thumb = document.createElement('img');
      thumb.className = 'memory-card-thumb';
      thumb.alt = '';
      // make a small object URL from the stored photo blob
      const blob = item.cardKind === 'memory' ? item.photoBlob : item.photoBlobs[0];
      if (blob) thumb.src = URL.createObjectURL(blob);

      const body = document.createElement('div');
      body.className = 'memory-card-body';

      const title = document.createElement('div');
      title.className = 'memory-card-title';
      title.textContent = item.title;

      const meta = document.createElement('div');
      meta.className = 'memory-card-meta';
      meta.textContent = item.cardKind === 'memory'
        ? `Talking memory • saved ${formatDate(item.createdAt)}${item.audioBlob ? ' • has voice' : ''}`
        : `Birthday project • updated ${formatDate(item.updatedAt)} • ${item.photoBlobs.length} photos`;

      body.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'memory-card-actions';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-primary';
      open.textContent = '▶️ Open';
      open.addEventListener('click', () => openItem(item));

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'btn btn-secondary';
      rename.textContent = '✏️ Rename';
      rename.addEventListener('click', () => showRename(item));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-secondary';
      del.textContent = '🗑️ Delete';
      del.addEventListener('click', () => confirmDelete(item));

      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'btn btn-secondary';
      download.textContent = '💾 Download';
      download.addEventListener('click', () => downloadItem(item));

      actions.append(open, download, rename, del);
      card.append(thumb, body, actions);
      els.list.appendChild(card);
    });
  }

  /* ---------- open / replay ---------- */

  async function openItem(item) {
    viewerItem = item;
    els.viewerTitle.textContent = item.title;
    els.viewerStory.textContent = '';

    if (item.cardKind === 'memory') {
      els.viewerPhoto.src = URL.createObjectURL(item.photoBlob);
      els.viewerPhoto.hidden = false;
      els.viewerStory.textContent = item.story ? `“${item.story}”` : '';
      if (item.audioBlob) {
        els.viewerAudio.src = URL.createObjectURL(item.audioBlob);
        els.viewerAudio.hidden = false;
        els.viewerAudio.play().catch(() => {});
      } else if (item.story && 'speechSynthesis' in window) {
        // no audio attached → read the story aloud
        const utterance = new SpeechSynthesisUtterance(item.story);
        utterance.rate = 0.9;
        utterance.lang = 'en-US';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    } else {
      // Birthday project: load it back into the Birthday Video Maker
      els.viewer.hidden = true;
      try {
        const project = await MemoryDB.getProject(item.id);
        if (project && BirthdayMaker.loadProject) {
          BirthdayMaker.loadProject(project);
          location.hash = 'birthday';
          return;
        }
      } catch (err) { /* fall through to inline view */ }
      // fallback: show first photo inline
      if (item.photoBlobs[0]) {
        els.viewerPhoto.src = URL.createObjectURL(item.photoBlobs[0]);
        els.viewerPhoto.hidden = false;
      }
      els.viewer.hidden = false;
      return;
    }
    els.viewer.hidden = false;
  }

  function closeViewer() {
    els.viewer.hidden = true;
    if (!els.viewerAudio.paused) els.viewerAudio.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    viewerItem = null;
  }

  /* ---------- download ---------- */

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function downloadItem(item) {
    if (item.cardKind === 'memory') {
      if (item.photoBlob) saveBlob(item.photoBlob, `${item.title}-photo.jpg`);
      if (item.audioBlob) saveBlob(item.audioBlob, `${item.title}-voice.webm`);
      return;
    }
    // project: download all photos (and audio) individually
    const project = await MemoryDB.getProject(item.id);
    if (!project) return;
    project.photoBlobs.forEach((blob, i) =>
      saveBlob(blob, `${item.title}-photo-${i + 1}.jpg`)
    );
    if (project.audioBlob) saveBlob(project.audioBlob, `${item.title}-narration.webm`);
  }

  function downloadViewerMedia() {
    if (viewerItem) downloadItem(viewerItem);
  }

  /* ---------- rename ---------- */

  function showRename(item) {
    renameTarget = { kind: item.cardKind === 'memory' ? 'memories' : 'projects', id: item.id };
    els.renameInput.value = item.title;
    els.renameDialog.hidden = false;
    els.renameInput.focus();
  }

  function hideRename() {
    els.renameDialog.hidden = true;
    renameTarget = null;
  }

  async function confirmRename() {
    const title = els.renameInput.value.trim();
    if (!title || !renameTarget) { hideRename(); return; }
    try {
      if (renameTarget.kind === 'memories') {
        const record = await MemoryDB.getMemory(renameTarget.id);
        if (record) { record.title = title; await MemoryDB.updateMemory(record); }
      } else {
        const record = await MemoryDB.getProject(renameTarget.id);
        if (record) { record.title = title; await MemoryDB.updateProject(record); }
      }
      hideRename();
      await refresh();
    } catch (err) {
      els.usage.textContent = MemoryDB.friendlyError(err);
    }
  }

  /* ---------- delete (with confirmation) ---------- */

  async function confirmDelete(item) {
    // Confirmation REQUIRED before deleting — plain confirm() keeps it simple
    // and is fully screen-reader/keyboard accessible.
    const ok = window.confirm(
      `Do you really want to delete "${item.title}"? This cannot be undone.`
    );
    if (!ok) return;
    try {
      if (item.cardKind === 'memory') await MemoryDB.deleteMemory(item.id);
      else await MemoryDB.deleteProject(item.id);
      await refresh();
    } catch (err) {
      els.usage.textContent = MemoryDB.friendlyError(err);
    }
  }

  return { init, refresh };
})();
