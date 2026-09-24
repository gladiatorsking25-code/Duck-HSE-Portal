// auth.js — a lightweight, CLIENT-SIDE-ONLY access gate for this trial tool.
//
// IMPORTANT: this is NOT real security. The credentials below live in plain
// text in a file the browser downloads and can be read by anyone with the
// page open (view-source, devtools, etc.), and there is no server to enforce
// anything. It exists only to keep this educational/trial build from being
// stumbled into by accident. Do not rely on it to protect real operational
// or personal data — use a proper authenticated backend for that.

const AUTH = {
  SESSION_KEY: 'cla_auth_ok',
  CREDENTIALS: { username: 'Sabir', password: 'admin' },

  isLoggedIn() {
    return sessionStorage.getItem(this.SESSION_KEY) === '1';
  },
  login(username, password) {
    const ok = username === this.CREDENTIALS.username && password === this.CREDENTIALS.password;
    if (ok) sessionStorage.setItem(this.SESSION_KEY, '1');
    return ok;
  },
  logout() {
    sessionStorage.removeItem(this.SESSION_KEY);
  }
};

// Call at the very top of every protected page (before other scripts run) to
// redirect straight to the login screen if there's no active session.
function requireAuth() {
  if (!AUTH.isLoggedIn()) {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.replace('login.html?next=' + next);
  }
}
