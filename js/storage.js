/* ============================================================
   storage.js — tiny helper for saving small text in the
   browser (localStorage). Photos stay in memory only; stories
   are kept per photo so they survive a page reload.
   ============================================================ */

const MemoryStore = {
  /**
   * Save a story for a given photo key.
   * @param {string} key  stable key for the photo
   * @param {string} text user's story
   */
  saveStory(key, text) {
    try {
      const all = this._all();
      all[key] = text;
      localStorage.setItem('memorybridge.stories', JSON.stringify(all));
    } catch (err) {
      console.warn('Could not save story:', err);
    }
  },

  getStory(key) {
    return this._all()[key] || '';
  },

  _all() {
    try {
      return JSON.parse(localStorage.getItem('memorybridge.stories') || '{}');
    } catch {
      return {};
    }
  }
};
