import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { Accept: 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('llcc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('llcc_token');
      localStorage.removeItem('llcc_user');
      if (!String(error.config?.url || '').includes('/auth/login')) {
        window.dispatchEvent(new CustomEvent('llcc:unauthorized'));
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data;
  if (typeof data === 'string') return data;
  return data?.message || error?.message || fallback;
}

/** Download an authenticated endpoint as a file without exposing the URL. */
export async function downloadBlob(url, filename, { method = 'get', data } = {}) {
  const response = await api.request({ url, method, data, responseType: 'blob' });
  const disposition = response.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const finalName = filename || (match ? decodeURIComponent(match[1]) : 'download');
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = finalName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
}

/** Fetch an authenticated endpoint as a Blob URL (for inline PDF/image preview). */
export async function fetchBlobUrl(url) {
  const response = await api.get(url, { responseType: 'blob' });
  return window.URL.createObjectURL(new Blob([response.data], { type: response.data.type }));
}

export default api;
