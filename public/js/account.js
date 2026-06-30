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
  const walletBalance = document.getElementById('walletBalance');
  const walletTopupForm = document.getElementById('walletTopupForm');
  const walletAmountInput = document.getElementById('walletAmount');
  const walletTopupMessage = document.getElementById('walletTopupMessage');
  const walletTopupHistory = document.getElementById('walletTopupHistory');
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

  function formatCurrency(amount) {
    return 'GHS ' + (Number(amount) || 0).toFixed(2);
  }

  function showWalletMessage(message, isError = false) {
    if (!walletTopupMessage) return;
    walletTopupMessage.textContent = message;
    walletTopupMessage.className = 'wallet-message ' + (isError ? 'error' : 'success');
    walletTopupMessage.classList.remove('hidden');
  }

  function renderWallet(wallet) {
    if (!walletBalance) return;
    walletBalance.textContent = formatCurrency(wallet.balance || 0);

    if (!walletTopupHistory) return;

    if (!wallet || !Array.isArray(wallet.topups) || wallet.topups.length === 0) {
      walletTopupHistory.innerHTML = '<p class="wallet-history-empty">No top-ups yet.</p>';
      return;
    }

    walletTopupHistory.innerHTML = wallet.topups
      .map((topup) => {
        const status = topup.status || 'pending_payment';
        return `
          <article class="wallet-item">
            <div class="wallet-item-meta">
              <strong>${escapeHtml(topup.topupId)}</strong>
              <span>${formatDate(topup.createdAt)}</span>
            </div>
            <div class="wallet-item-body">
              <span>${formatCurrency(topup.amount)}</span>
              <span class="wallet-item-status ${escapeHtml(status)}">${escapeHtml(status.replace('_', ' '))}</span>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function clearWalletMessage() {
    if (!walletTopupMessage) return;
    walletTopupMessage.textContent = '';
    walletTopupMessage.className = 'wallet-message hidden';
  }

  async function handleWalletTopup(event) {
    event.preventDefault();
    clearWalletMessage();

    if (!walletAmountInput || !walletTopupForm) return;

    const amount = Number(walletAmountInput.value);
    if (!amount || amount <= 0) {
      showWalletMessage('Please enter a valid top-up amount.', true);
      return;
    }

    walletTopupForm.querySelector('button[type="submit"]').disabled = true;
    walletTopupForm.querySelector('button[type="submit"]').textContent = 'Starting top-up…';

    try {
      const response = await fetch(API_BASE + '/api/wallet/topup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ amount }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not start wallet top-up');
      }

      const data = await response.json();
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
        return;
      }

      showWalletMessage(data.error || 'Could not start wallet top-up', true);
    } catch (err) {
      console.error('Wallet top-up error:', err);
      showWalletMessage(err.message || 'Network error. Please try again.', true);
    } finally {
      const button = walletTopupForm.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = false;
        button.textContent = 'Top up wallet';
      }
    }
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
              <div class="order-carriers">
                Carrier(s): ${escapeHtml(
                  [...new Set((o.items || []).map((i) => i.carrier).filter(Boolean))].join(', ') || 'Unknown'
                )}
              </div>
              <div class="order-items">
                ${(o.items || [])
                  .map((i) => `${escapeHtml(i.name || 'Unknown')} (${escapeHtml(i.carrier || 'Unknown')}) × ${i.quantity || 1}`)
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

  function handleDepositParams() {
    const params = new URLSearchParams(window.location.search);
    const depositStatus = params.get('deposit');
    const topupId = params.get('topup');

    if (!depositStatus) return;

    let message = '';
    let isError = false;

    if (depositStatus === 'success') {
      message = `Wallet top-up successful${topupId ? ' (' + escapeHtml(topupId) + ')' : ''}.`;
    } else if (depositStatus === 'processing') {
      message = `Wallet top-up is processing${topupId ? ' (' + escapeHtml(topupId) + ')' : ''}. Refresh later if needed.`;
    } else if (depositStatus === 'failed') {
      message = `Wallet top-up failed${topupId ? ' (' + escapeHtml(topupId) + ')' : ''}. Please try again.`;
      isError = true;
    }

    if (message) {
      showWalletMessage(message, isError);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
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
      fetch(API_BASE + '/api/account/wallet', { headers: authHeaders() }).then((r) => {
        if (!r.ok) {
          if (r.status === 401) {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_USER_KEY);
            throw new Error('Token expired');
          }
          throw new Error('Failed to fetch wallet data');
        }
        return r.json();
      }),
    ])
      .then(([meData, ordersData, walletData]) => {
        if (meData.error || !meData.user) {
          showError();
          return;
        }

        const user = meData.user;
        profileName.textContent = user.name || '—';
        profileEmail.textContent = user.email || '—';
        profilePhone.textContent = user.phone || '—';

        renderOrders(Array.isArray(ordersData) ? ordersData : []);
        renderWallet(walletData || { balance: 0, topups: [] });
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

    if (walletTopupForm) {
      walletTopupForm.addEventListener('submit', handleWalletTopup);
    }

    handleDepositParams();

    loadAccount();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();