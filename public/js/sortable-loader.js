/**
 * Load SortableJS on demand (kanban view only — keeps table-first pipeline load lighter).
 */
(function (global) {
  var loading = null;

  function ensureSortableJs() {
    if (typeof global.Sortable !== 'undefined') {
      return Promise.resolve();
    }
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js';
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        loading = null;
        reject(new Error('Failed to load SortableJS'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  global.__ensureSortableJs = ensureSortableJs;
})(typeof window !== 'undefined' ? window : global);
