// Provider metadata only: never fetch these URLs or interpret titles as markup.
function sourceURL(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    const normalized = url.href.replace(/[<>]/g, c => c === '<' ? '%3C' : '%3E');
    return normalized.length <= 8192 ? normalized : undefined;
  } catch { return; }
}
function sourceTitle(value, url) {
  let title = '', bytes = 0;
  if (typeof value === 'string') for (const point of Buffer.from(value).toString('utf8').replace(/[\x00-\x1f\x7f]/g, ' ').trim()) {
    const size = Buffer.byteLength(point); if (bytes + size > 1000) break;
    title += point; bytes += size;
  }
  return title || new URL(url).hostname;
}
function createSources(onSources) {
  const entries = new Map();
  const snapshot = () => [...entries.values()].map(s => ({ ...s }));
  const publish = () => { if (typeof onSources === 'function') onSources(snapshot()); };
  return {
    add(value, title, preferredId) {
      const url = sourceURL(value); if (!url) return;
      const previous = entries.get(url), normalized = sourceTitle(title, url);
      if (previous) {
        if (typeof title === 'string' && title.trim() && previous.title !== normalized) { previous.title = normalized; publish(); }
        return { ...previous };
      }
      if (entries.size >= 100) return;
      const used = new Set([...entries.values()].map(s => s.id));
      let id = /^[1-9][0-9]{0,2}$/.test(String(preferredId)) && Number(preferredId) <= 100 && !used.has(String(preferredId)) ? String(preferredId) : '1';
      while (used.has(id)) id = String(Number(id) + 1);
      const source = { id, url, title: normalized }; entries.set(url, source); publish(); return { ...source };
    },
    snapshot, publish,
  };
}
module.exports = { sourceURL, sourceTitle, createSources };
