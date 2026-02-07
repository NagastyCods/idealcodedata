(function () {
  const API_BASE = '';
  const AUTH_TOKEN_KEY = 'idealdata_token';
  const AUTH_USER_KEY = 'idealdata_user';

  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const loginPanel = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');
  const loginBtn = document.getElementById('loginBtn');
  const signupBtn = document.getElementById('signupBtn');
  const toast = document.getElementById('toast');
  const tabs = document.querySelectorAll('.auth-tab');

  /**
   * Show toast notification
   */
  function showToast(message, isError) {
    toast.textContent = message;
    toast.classList.toggle('error', !!isError);
    toast.classList.remove('hidden', 'show');
    // Trigger reflow to restart animation
    toast.offsetHeight;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  /**
   * Switch between login and signup tabs
   */
  function setTab(activeTab) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab));
    loginPanel.classList.toggle('active', activeTab === 'login');
    signupPanel.classList.toggle('active', activeTab === 'signup');
  }

  /**
   * Save authentication token and user data to localStorage
   */
  function saveAuth(token, user) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  }

  /**
   * Validate email format
   */
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /**
   * Validate Ghana phone number format
   */
  function isValidPhone(phone) {
    const clean = String(phone).replace(/\s/g, '');
    return /^0\d{9}$/.test(clean);
  }

  /**
   * Redirect user after successful authentication
   */
  function redirectAfterAuth() {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');

    if (redirect === 'checkout') {
      window.location.href = '/?checkout=1';
    } else if (redirect === 'account') {
      window.location.href = '/account';
    } else {
      window.location.href = '/';
    }
  }

  /**
   * Tab switching
   */
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });

  /**
   * Handle login form submission
   */
  loginForm?.addEventListener('submit', function (e) {
    e.preventDefault();

    const email = document.getElementById('loginEmail')?.value.trim() || '';
    const password = document.getElementById('loginPassword')?.value || '';

    // Validation
    if (!email || !password) {
      showToast('Please enter email and password', true);
      return;
    }

    if (!isValidEmail(email)) {
      showToast('Please enter a valid email address', true);
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.toLowerCase(), password }),
    })
      .then((r) => {
        if (!r.ok) {
          return r.json().then((data) => {
            throw new Error(data.error || 'Sign in failed');
          });
        }
        return r.json();
      })
      .then((data) => {
        if (data.token && data.user) {
          saveAuth(data.token, data.user);
          showToast('Welcome back, ' + (data.user.name || 'user') + '!');
          setTimeout(() => redirectAfterAuth(), 1000);
        } else {
          showToast(data.error || 'Sign in failed', true);
          loginBtn.disabled = false;
          loginBtn.textContent = 'Sign in';
        }
      })
      .catch((err) => {
        console.error('Login error:', err);
        showToast(err.message || 'Network error. Please try again.', true);
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign in';
      });
  });

  /**
   * Handle signup form submission
   */
  signupForm?.addEventListener('submit', function (e) {
    e.preventDefault();

    const name = document.getElementById('signupName')?.value.trim() || '';
    const email = document.getElementById('signupEmail')?.value.trim().toLowerCase() || '';
    const phone = document.getElementById('signupPhone')?.value || '';
    const password = document.getElementById('signupPassword')?.value || '';

    // Validation
    if (!name || !email || !phone || !password) {
      showToast('Please fill in all fields', true);
      return;
    }

    if (!isValidEmail(email)) {
      showToast('Please enter a valid email address', true);
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters', true);
      return;
    }

    if (!isValidPhone(phone)) {
      showToast('Please enter a valid Ghana phone number (0XXXXXXXXX)', true);
      return;
    }

    signupBtn.disabled = true;
    signupBtn.textContent = 'Creating account…';

    fetch(API_BASE + '/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        phone: phone.replace(/\s/g, ''),
        password,
      }),
    })
      .then((r) => {
        if (!r.ok) {
          return r.json().then((data) => {
            throw new Error(data.error || 'Sign up failed');
          });
        }
        return r.json();
      })
      .then((data) => {
        if (data.token && data.user) {
          saveAuth(data.token, data.user);
          showToast('Account created! Welcome, ' + data.user.name + '.');
          setTimeout(() => redirectAfterAuth(), 1000);
        } else {
          showToast(data.error || 'Sign up failed', true);
          signupBtn.disabled = false;
          signupBtn.textContent = 'Create account';
        }
      })
      .catch((err) => {
        console.error('Signup error:', err);
        showToast(err.message || 'Network error. Please try again.', true);
        signupBtn.disabled = false;
        signupBtn.textContent = 'Create account';
      });
  });

  /**
   * Initialize page
   */
  function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'signup') setTab('signup');

    // Redirect if already logged in
    if (localStorage.getItem(AUTH_TOKEN_KEY)) {
      redirectAfterAuth();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();