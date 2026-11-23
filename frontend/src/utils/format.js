export function formatDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function formatDateTime(value) {
  return formatDate(value, { withTime: true });
}

export function relativeTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
    ['hour', 3600000], ['minute', 60000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
      return future ? `in ${label}` : `${label} ago`;
    }
  }
  return 'just now';
}

export function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name = '') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'LL';
}

export function daysUntil(value) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

export function queryString(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}
