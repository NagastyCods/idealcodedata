(function () {
  const LOGIN_KEY = 'idealdata_admin_token';
  const API_BASE = '';

  const loginScreen = document.getElementById('loginScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const loginForm = document.getElementById('loginForm');
  const adminPassword = document.getElementById('adminPassword');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');
  const adminOrdersList = document.getElementById('adminOrdersList');

  /**
   * Get stored admin token from localStorage
   */
  function getToken() {
    return localStorage.getItem(LOGIN_KEY);
  }

  /**
   * Save or remove admin token
   */
  function setToken(token) {
    if (token) {
      localStorage.setItem(LOGIN_KEY, token);
    } else {
      localStorage.removeItem(LOGIN_KEY);
    }
  }

  /**
   * Create authorization headers with JWT token
   */
  function authHeaders() {
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  /**
   * Show login screen
   */
  function showLogin() {
    loginScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
  }

  /**
   * Show dashboard
   */
  function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    fetchOrders();
  }

  /**
   * Format ISO date to readable format
   */
  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
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
   * Fetch all orders from server
   */
  function fetchOrders() {
    const token = getToken();
    if (!token) {
      showLogin();
      return;
    }

    adminOrdersList.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Loading orders...</p>';

    fetch(API_BASE + '/api/orders', {
      headers: authHeaders(),
    })
      .then((r) => {
        if (r.status === 401) {
          setToken(null);
          showLogin();
          throw new Error('Session expired');
        }

        if (!r.ok) {
          throw new Error('Failed to fetch orders');
        }

        return r.json();
      })
      .then((orders) => {
        renderOrders(Array.isArray(orders) ? orders : []);
      })
      .catch((err) => {
        console.error('Fetch orders error:', err);
        if (err.message !== 'Session expired') {
          adminOrdersList.innerHTML =
            '<p style="color: var(--text-muted); text-align: center;">Failed to load orders. Please try again.</p>';
        }
      });
  }

  /**
   * Update order status
   */
  function updateOrderStatus(orderId, status) {
    const token = getToken();
    if (!token) {
      showLogin();
      return;
    }

    fetch(API_BASE + '/api/orders/' + encodeURIComponent(orderId), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ status }),
    })
      .then((r) => {
        if (r.status === 401) {
          setToken(null);
          showLogin();
          return null;
        }

        if (!r.ok) {
          throw new Error('Failed to update order');
        }

        return r.json();
      })
      .then((data) => {
        if (data) {
          fetchOrders(); // Refresh list
        }
      })
      .catch((err) => {
        console.error('Update order error:', err);
        alert('Failed to update order status');
      });
  }

  /**
   * Render orders list
   */
  function renderOrders(orders) {
    if (!orders || orders.length === 0) {
      adminOrdersList.innerHTML =
        '<p class="orders-empty" style="color: var(--text-muted); padding: 2rem 0; text-align: center;">No orders yet.</p>';
      return;
    }

    const statuses = [
      { value: 'pending_payment', label: 'Awaiting payment' },
      { value: 'pending', label: 'Processing' },
      { value: 'paid', label: 'Paid' },
      { value: 'completed', label: 'Completed' },
      { value: 'failed', label: 'Failed' },
    ];

    adminOrdersList.innerHTML = orders
      .map((o) => {
        const statusClass = escapeHtml(o.status || 'pending_payment');
        const statusText = formatStatus(o.status || 'pending_payment');

        return `
          <article class="admin-order-card" data-order-id="${escapeHtml(o.orderId)}">
            <div class="admin-order-header">
              <div class="admin-order-meta">
                <span><strong>${escapeHtml(o.orderId)}</strong></span>
                <span>${formatDate(o.createdAt)}</span>
                <span>${escapeHtml(o.phone || '—')}</span>
                ${o.email ? '<span>' + escapeHtml(o.email) + '</span>' : ''}
                ${o.name ? '<span>' + escapeHtml(o.name) + '</span>' : ''}
                <span class="order-status ${statusClass}">${statusText}</span>
              </div>
              <div class="admin-order-actions">
                <select data-order-id="${escapeHtml(o.orderId)}" aria-label="Change status">
                  ${statuses
                    .map(
                      (s) =>
                        `<option value="${s.value}" ${o.status === s.value ? 'selected' : ''}>${s.label}</option>`
                    )
                    .join('')}
                </select>
                <button type="button" class="btn btn-primary btn-sm" data-action="apply" data-order-id="${escapeHtml(
                  o.orderId
                )}">Update</button>
              </div>
            </div>
            <div class="admin-order-body">
              <div class="admin-order-items">
                ${(o.items || [])
                  .map((i) => `${escapeHtml(i.name || 'Unknown')} × ${i.quantity || 1}`)
                  .join(' · ')}
              </div>
              <div class="admin-order-total">Total: GHS ${(o.total || 0).toFixed(2)}</div>
            </div>
          </article>
        `;
      })
      .join('');

    // Attach event listeners to update buttons
    adminOrdersList.querySelectorAll('[data-action="apply"]').forEach((btn) => {
      btn.addEventListener('click', function () {
        const orderId = this.dataset.orderId;
        const select = adminOrdersList.querySelector(`select[data-order-id="${orderId}"]`);
        const status = select ? select.value : null;

        if (status) {
          updateOrderStatus(orderId, status);
        }
      });
    });
  }

  /**
   * Handle login form submission
   */
  loginForm?.addEventListener('submit', function (e) {
    e.preventDefault();

    loginError.classList.add('hidden');
    const password = adminPassword.value.trim();

    if (!password) {
      loginError.textContent = 'Please enter a password';
      loginError.classList.remove('hidden');
      return;
    }

    loginForm.style.opacity = '0.6';
    loginForm.style.pointerEvents = 'none';

    fetch(API_BASE + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
      .then((r) => {
        if (!r.ok) {
          return r.json().then((data) => {
            throw new Error(data.error || 'Login failed');
          });
        }
        return r.json();
      })
      .then((data) => {
        if (data.token) {
          setToken(data.token);
          adminPassword.value = '';
          showDashboard();
        } else {
          loginError.textContent = data.error || 'Invalid password';
          loginError.classList.remove('hidden');
        }
      })
      .catch((err) => {
        console.error('Admin login error:', err);
        loginError.textContent = err.message || 'Network error. Try again.';
        loginError.classList.remove('hidden');
      })
      .finally(() => {
        loginForm.style.opacity = '1';
        loginForm.style.pointerEvents = 'auto';
      });
  });

  /**
   * Handle logout
   */
  logoutBtn?.addEventListener('click', function () {
    setToken(null);
    showLogin();
    adminPassword.value = '';
  });

  /**
   * Initialize page
   */
  function init() {
    if (getToken()) {
      showDashboard();
    } else {
      showLogin();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();