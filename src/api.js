const API_BASE = 'http://localhost:5000/api';

export function getToken() {
  return localStorage.getItem('edumart_token');
}

export function setAuth(token, user) {
  localStorage.setItem('edumart_token', token);
  localStorage.setItem('edumart_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('edumart_token');
  localStorage.removeItem('edumart_user');
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('edumart_user') || 'null');
  } catch {
    return null;
  }
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    if (!res.ok) throw new Error('Locked content: purchase required');
    return res.blob();
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export function formatINR(paise) {
  return `₹${(Number(paise || 0) / 100).toFixed(2)}`;
}