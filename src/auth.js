export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = '203630';
export const SESSION_KEY = 'sastreria-admin-session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export function validateLogin({ username = '', password = '' } = {}) {
  const safeUsername = String(username).trim();
  const safePassword = String(password).trim();

  return safeUsername === ADMIN_USERNAME && safePassword === ADMIN_PASSWORD;
}

export function readSession() {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    if (!value) return false;

    const session = JSON.parse(value);
    if (!session || session.valid !== true) return false;

    if (typeof session.expiresAt !== 'number') return false;
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function saveSession() {
  try {
    const payload = {
      valid: true,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures in restricted/private browsing contexts.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage failures in restricted/private browsing contexts.
  }
}
