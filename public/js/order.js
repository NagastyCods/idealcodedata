(function () {
  const AUTH_TOKEN_KEY = 'idealdata_token';
  const AUTH_USER_KEY = 'idealdata_user';
  const API_BASE = window.location.origin;

  const form = document.getElementById('ordersForm');
  const phoneInput = document.getElementById('phone');
  const fetchBtn = document.getElementById('fetchBtn');
  const paymentMessage = document.getElementById('paymentMessage');
  const ordersSection = document.getElementById('ordersSection');
  const ordersList = document.getElementById('ordersList');
  const ordersEmpty = document.getElementById('ordersEmpty');
  const navLogin = document.getElementById('navLogin');
  const navAccount = document.getElementById('navAccount');
  const navLogout = document.getElementById('navLogout');

  /**
   * Get stored auth user from localStorage
   */
  function getAuthUser() {
    try {
      const u = localStorage.getItem(AUTH_USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if user is logged in
   */
  function isLoggedIn() {
    return !!localStorage.getItem(AUTH_TOKEN_KEY);
  }

  /**
   * Get JWT token from localStorage
   */
  function getToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  /**
   * Update navigation based on login status
   */
  function updateAuthNav() {
    const loggedIn = isLoggedIn();
    if (navLogin) navLogin.classList.toggle('hidden', loggedIn);
    if (navAccount) navAccount.classList.toggle('hidden', !loggedIn);
    if (navLogout) navLogout.classList.toggle('hidden', !loggedIn);
  }

  /**
   * Create authorization headers with JWT token
   */
  function authHeaders() {
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  /**
   * Display message to user
   */
  function showMessage(msg, type) {
    paymentMessage.textContent = msg;
    paymentMessage.className = 'payment-message ' + (type || '');
    paymentMessage.classList.remove('hidden');
  }

  /**
   * Hide message
   */
  function hideMessage() {
    paymentMessage.classList.add('hidden');
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
   * Render orders list on the page
   */
  function renderOrders(orders) {
    if (!orders || !orders.length) {
      ordersSection.classList.add('hidden');
      ordersEmpty.classList.remove('hidden');
      return;
    }

    ordersEmpty.classList.add('hidden');
    ordersSection.classList.remove('hidden');

    ordersList.innerHTML = orders
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
   * Check for payment parameters in URL and show appropriate message
   */
  async function checkPaymentParams() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    let orderId = params.get('order');

    if (!payment || !orderId) return;

    // Handle multiple order IDs separated by commas
    orderId = String(orderId).split(',')[0].trim();

    try {
      const res = await fetch(API_BASE + '/api/orders/' + encodeURIComponent(orderId));

      if (!res.ok) {
        throw new Error('Order not found');
      }

      const order = await res.json();

      if (order && order.status === 'paid') {
        showMessage(
          'Payment successful for order ' + escapeHtml(orderId) + '. Your data will be delivered shortly.',
          'success'
        );
      } else if (order && order.status === 'pending') {
        showMessage(
          'Payment for order ' + escapeHtml(orderId) + ' is being processed. Please wait.',
          'success'
        );
      } else if (order && order.status === 'pending_payment') {
        showMessage(
          'Payment for order ' + escapeHtml(orderId) + ' is awaiting payment confirmation.',
          'warning'
        );
      } else if (payment === 'success') {
        showMessage(
          'Payment successful for order ' + escapeHtml(orderId) + '.',
          'success'
        );
      } else if (payment === 'processing') {
        showMessage(
          'Payment for order ' + escapeHtml(orderId) + ' is being processed.',
          'info'
        );
      } else if (payment === 'failed') {
        showMessage(
          'Payment for order ' + escapeHtml(orderId) + ' failed. Please try again.',
          'error'
        );
      } else {
        showMessage(
          'Payment verification is in progress. Please refresh shortly.',
          'info'
        );
      }
    } catch (err) {
      console.error('Payment verification error:', err);
      showMessage(
        'Payment received. Final confirmation is in progress.',
        'info'
      );
    }

    // Clean URL to remove payment parameters
    window.history.replaceState({}, '', '/orders');
  }

  /**
   * Handle form submission to fetch orders by phone
   */
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    const phone = phoneInput.value.trim().replace(/\s/g, '');

    // Validate Ghana phone number format
    if (!/^0\d{9}$/.test(phone)) {
      showMessage('Please enter a valid Ghana phone number (0XXXXXXXXX).', 'error');
      return;
    }

    hideMessage();
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Loading…';

    // Fetch orders by phone number
    fetch(API_BASE + '/api/orders?phone=' + encodeURIComponent(phone))
      .then((r) => {
        if (!r.ok) {
          throw new Error('Failed to fetch orders');
        }
        return r.json();
      })
      .then((data) => {
        renderOrders(Array.isArray(data) ? data : []);
        if (!Array.isArray(data) || data.length === 0) {
          showMessage('No orders found for this phone number.', 'info');
        }
      })
      .catch((err) => {
        console.error('Fetch orders error:', err);
        showMessage('Could not load orders. Please try again.', 'error');
        ordersSection.classList.add('hidden');
        ordersEmpty.classList.add('hidden');
      })
      .finally(() => {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'View orders';
      });
  });

  /**
   * Handle logout
   */
  navLogout?.addEventListener('click', function (e) {
    e.preventDefault();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    updateAuthNav();
    renderOrders([]);
    phoneInput.value = '';
    showMessage('Logged out successfully.', 'success');
    window.location.href = '/';
  });

  /**
   * Initialize page
   */
  function init() {
    // Check for payment callback parameters
    checkPaymentParams();
    updateAuthNav();

    // Pre-fill phone number if user is logged in
    const user = getAuthUser();
    if (user && user.phone) {
      phoneInput.value = user.phone;
      phoneInput.placeholder = user.phone;
    }

    // Load authenticated user's orders if logged in
    if (isLoggedIn()) {
      fetch(API_BASE + '/api/account/orders', {
        headers: authHeaders(),
      })
        .then((r) => {
          if (!r.ok) {
            if (r.status === 401) {
              // Token expired or invalid
              localStorage.removeItem(AUTH_TOKEN_KEY);
              localStorage.removeItem(AUTH_USER_KEY);
              updateAuthNav();
              return [];
            }
            throw new Error('Failed to fetch orders');
          }
          return r.json();
        })
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            renderOrders(data);
            showMessage('Welcome back! Here are your orders.', 'success');
          } else {
            renderOrders([]);
          }
        })
        .catch((err) => {
          console.error('Load account orders error:', err);
          ordersEmpty.classList.remove('hidden');
          ordersSection.classList.add('hidden');
        });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();