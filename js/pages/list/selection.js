/** Selection stores public references across pages; the range anchor belongs to one result page. */
export function createListSelection(selected) {
  let anchor = null;
  let rangeBase = new Map();
  return {
    resetAnchor() {
      anchor = null;
      rangeBase = new Map();
    },
    select(rows, code, { shiftKey = false, ctrlKey = false, metaKey = false, toggle = false } = {}) {
      const available = rows.filter(row => !row.needsCrawl);
      const end = available.findIndex(row => row.code === code);
      if (end < 0) return false;
      const additive = ctrlKey || metaKey;
      const start = available.findIndex(row => row.code === anchor);
      if (shiftKey && start >= 0) {
        selected.clear();
        if (additive) for (const [key, name] of rangeBase) selected.set(key, name);
        for (const row of available.slice(Math.min(start, end), Math.max(start, end) + 1)) {
          selected.set(row.code, row.name || row.code);
        }
      } else {
        const remove = (additive || toggle) && selected.has(code);
        if (!additive && !toggle) selected.clear();
        if (remove) selected.delete(code);
        else selected.set(code, available[end].name || code);
        anchor = code;
        rangeBase = new Map(selected);
      }
      return true;
    },
  };
}
