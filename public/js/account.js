(function () {
  const AUTH_TOKEN_KEY = 'idealdata_token';
  const AUTH_USER_KEY = 'idealdata_user';
  const API_BASE = '';

  const accountLoading = document.getElementById('accountLoading');
  const accountContent = document.getElementById('accountContent');
  const accountError = document.getElementById('accountError');
  const profileName = document.getElementById('profileName');
  const profileEmail = document.getElementById('profileEmail');
  const profilePhone = document.getElementById('profilePhone');
  const accountOrdersList = document.getElementById('accountOrdersList');
  const accountOrdersEmpty = document.getElementById('accountOrdersEmpty');
  const navLogout = document.getElementById('navLogout');

  /**
   * Get JWT token from localStorage
   */
  function getToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  /**
   * Create authorization headers with JWT token
   */
  function authHeaders() {
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  /**
   * Check if user is logged in
   */
  function isLoggedIn() {
    return !!getToken();
  }

  /**
   * Format ISO date to readable format
   */
  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  /**
   * Format order status to human-readable text
   */
  function formatStatus(s) {
    const map = {
      pending_payment: 'Awaiting payment',
      pending: 'Processing',
      paid: 'Paid',
      completed: 'Completed',
      failed: 'Failed',
    };
    return map[s] || s;
  }

  /**
   * Escape HTML to prevent XSS attacks
   */
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /**
   * Render user's orders
   */
  function renderOrders(orders) {
    if (!orders || orders.length === 0) {
      accountOrdersList.classList.add('hidden');
      accountOrdersEmpty.classList.remove('hidden');
      return;
    }

    accountOrdersEmpty.classList.add('hidden');
    accountOrdersList.classList.remove('hidden');

    accountOrdersList.innerHTML = orders
      .map((o) => {
        const statusClass = escapeHtml(o.status || 'pending_payment');
        const statusText = formatStatus(o.status || 'pending_payment');

        return `
          <article class="order-card" data-order-id="${escapeHtml(o.orderId)}">
            <div class="order-card-header">
              <div>
                <span class="order-id">${escapeHtml(o.orderId)}</span>
                <span class="order-date">${formatDate(o.createdAt)}</span>
              </div>
              <span class="order-status ${statusClass}">${statusText}</span>
            </div>
            <div class="order-card-body">
              <div class="order-items">
                ${(o.items || [])
                  .map((i) => `${escapeHtml(i.name || 'Unknown')} × ${i.quantity || 1}`)
                  .join(' · ')}
              </div>
              <div class="order-total">Total: GHS ${(o.total || 0).toFixed(2)}</div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  /**
   * Show account content
   */
  function showContent() {
    accountLoading.classList.add('hidden');
    accountError.classList.add('hidden');
    accountContent.classList.remove('hidden');
  }

  /**
   * Show error state
   */
  function showError() {
    accountLoading.classList.add('hidden');
    accountContent.classList.add('hidden');
    accountError.classList.remove('hidden');
  }

  /**
   * Load account data and orders
   */
  function loadAccount() {
    const token = getToken();

    if (!token) {
      showError();
      return;
    }

    Promise.all([
      fetch(API_BASE + '/api/auth/me', { headers: authHeaders() }).then((r) => {
        if (!r.ok) {
          if (r.status === 401) {
            // Token expired or invalid
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_USER_KEY);
            throw new Error('Token expired');
          }
          throw new Error('Failed to fetch user data');
        }
        return r.json();
      }),
      fetch(API_BASE + '/api/account/orders', { headers: authHeaders() }).then((r) => {
        if (!r.ok) {
          if (r.status === 401) {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_USER_KEY);
            throw new Error('Token expired');
          }
          throw new Error('Failed to fetch orders');
        }
        return r.json();
      }),
    ])
      .then(([meData, ordersData]) => {
        if (meData.error || !meData.user) {
          showError();
          return;
        }

        const user = meData.user;
        profileName.textContent = user.name || '—';
        profileEmail.textContent = user.email || '—';
        profilePhone.textContent = user.phone || '—';

        renderOrders(Array.isArray(ordersData) ? ordersData : []);
        showContent();
      })
      .catch((err) => {
        console.error('Load account error:', err);
        if (err.message === 'Token expired') {
          window.location.href = '/auth';
        } else {
          showError();
        }
      });
  }

  /**
   * Handle logout
   */
  navLogout?.addEventListener('click', function (e) {
    e.preventDefault();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    window.location.href = '/';
  });

  /**
   * Initialize page
   */
  function init() {
    if (!isLoggedIn()) {
      showError();
      setTimeout(() => {
        window.location.href = '/auth?redirect=account';
      }, 2000);
      return;
    }

    loadAccount();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();