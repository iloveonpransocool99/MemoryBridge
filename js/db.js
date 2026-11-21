/* ============================================================
   db.js — IndexedDB persistence for "My Memories".

   Stores ONLY local, private data on this device:
     - "memories"  : Talking Photos saves
         { id, kind:'memory', title, createdAt, photoBlob,
           photoName, audioBlob|null, audioKind:null|'recorded'|'uploaded',
           story:'' }
     - "projects"  : Birthday video projects (finished or unfinished)
         { id, kind:'project', title, createdAt, updatedAt,
           photoBlobs:[Blob], photoNames:[string], audioBlob|null,
           settings:{ name, message, theme, secondsPerPhoto } }

   Large media lives here as Blobs — never in localStorage.
   Nothing is ever uploaded; IndexedDB is device-local storage.
   ============================================================ */

const MemoryDB = (() => {
  const DB_NAME = 'memorybridge';
  const DB_VERSION = 1;

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('memories')) {
          db.createObjectStore('memories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let requestResult;
      let failed = false;
      transaction.oncomplete = () => {
        if (!failed) resolve(requestResult);
      };
      transaction.onerror = () => {
        failed = true;
        reject(transaction.error);
      };
      transaction.onabort = () => {
        failed = true;
        reject(transaction.error || new Error('QuotaExceededError'));
      };
      try {
        const request = fn(store);
        if (request && typeof request.addEventListener === 'function') {
          request.addEventListener('success', () => { requestResult = request.result; });
          request.addEventListener('error', () => { failed = true; });
        }
      } catch (err) {
        failed = true;
        reject(err);
      }
    }));
  }

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ---------- memories (talking photos) ---------- */

  function saveMemory(data) {
    const record = {
      id: makeId(),
      kind: 'memory',
      title: data.title || 'My memory',
      createdAt: Date.now(),
      photoBlob: data.photoBlob,
      photoName: data.photoName || '',
      audioBlob: data.audioBlob || null,
      audioKind: data.audioKind || null,
      story: data.story || ''
    };
    return tx('memories', 'readwrite', (store) => store.add(record));
  }

  function updateMemory(record) {
    return tx('memories', 'readwrite', (store) => store.put(record));
  }

  function getAllMemories() {
    return open().then((db) => new Promise((resolve, reject) => {
      const request = db.transaction('memories', 'readonly').objectStore('memories').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    }));
  }

  function getMemory(id) {
    return open().then((db) => new Promise((resolve, reject) => {
      const request = db.transaction('memories', 'readonly').objectStore('memories').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }

  function deleteMemory(id) {
    return tx('memories', 'readwrite', (store) => store.delete(id));
  }

  /* ---------- birthday projects ---------- */

  function saveProject(data) {
    const record = {
      id: makeId(),
      kind: 'project',
      title: data.title || 'Birthday project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      photoBlobs: data.photoBlobs || [],
      photoNames: data.photoNames || [],
      audioBlob: data.audioBlob || null,
      settings: data.settings || {}
    };
    return tx('projects', 'readwrite', (store) => store.add(record));
  }

  function updateProject(record) {
    record.updatedAt = Date.now();
    return tx('projects', 'readwrite', (store) => store.put(record));
  }

  function getAllProjects() {
    return open().then((db) => new Promise((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error);
    }));
  }

  function getProject(id) {
    return open().then((db) => new Promise((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }

  function deleteProject(id) {
    return tx('projects', 'readwrite', (store) => store.delete(id));
  }

  /* ---------- storage estimate ---------- */

  async function estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage, quota, supported: true };
      } catch { /* fall through */ }
    }
    return { supported: false };
  }

  /** Translate IndexedDB failures into friendly senior-friendly text. */
  function friendlyError(err) {
    const name = err && (err.name || err.message || '');
    if (name === 'QuotaExceededError' || name === 'QUOTA' || /quota/i.test(name)) {
      return 'This device is full. Please delete some old memories, then try again.';
    }
    if (name === 'InvalidStateError') {
      return 'Private browsing does not allow saving. Please use normal browsing mode.';
    }
    return 'Saving did not work on this device. Please try again.';
  }

  return {
    saveMemory, updateMemory, getAllMemories, getMemory, deleteMemory,
    saveProject, updateProject, getAllProjects, getProject, deleteProject,
    estimate, friendlyError
  };
})();
