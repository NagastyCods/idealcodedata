/**
 * IdealData — Data bundles marketplace
 * MTN, AirtelTigo, Telecel Ghana
 */

const API_BASE = window.location.origin;
const AUTH_TOKEN_KEY = 'idealdata_token';
const AUTH_USER_KEY = 'idealdata_user';

const state = {
  bundles: [],
  bundlesById: {},
  cart: [],
  user: null,
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const el = {
  bundlesGrid: $('#bundlesGrid'),
  loading: $('#loading'),
  emptyState: $('#emptyState'),
  carrierFilter: $('#carrierFilter'),
  validityFilter: $('#validityFilter'),
  clearFilters: $('#clearFilters'),
  cartBtn: $('#cartBtn'),
  cartCount: $('#cartCount'),
  cartDrawer: $('#cartDrawer'),
  drawerBackdrop: $('#drawerBackdrop'),
  drawerClose: $('#drawerClose'),
  cartEmpty: $('#cartEmpty'),
  cartList: $('#cartList'),
  cartFooter: $('#cartFooter'),
  cartTotal: $('#cartTotal'),
  checkoutBtn: $('#checkoutBtn'),
  checkoutModal: $('#checkoutModal'),
  modalBackdrop: $('#modalBackdrop'),
  modalClose: $('#modalClose'),
  cancelCheckout: $('#cancelCheckout'),
  checkoutForm: $('#checkoutForm'),
  checkoutStepForm: $('#checkoutStepForm'),
  checkoutStepPay: $('#checkoutStepPay'),
  checkoutPhone: $('#checkoutPhone'),
  checkoutName: $('#checkoutName'),
  checkoutEmail: $('#checkoutEmail'),
  checkoutSummary: $('#checkoutSummary'),
  placeOrderBtn: $('#placeOrderBtn'),
  payOrderId: $('#payOrderId'),
  payAmount: $('#payAmount'),
  payNowBtn: $('#payNowBtn'),
  toast: $('#toast'),
  navLogin: $('#navLogin'),
  navAccount: $('#navAccount'),
  navLogout: $('#navLogout'),
};

let lastOrder = null;

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
 * Get stored user data
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
 * Update navigation based on login status
 */
function updateAuthNav() {
  const loggedIn = isLoggedIn();
  if (el.navLogin) el.navLogin.classList.toggle('hidden', loggedIn);
  if (el.navAccount) el.navAccount.classList.toggle('hidden', !loggedIn);
  if (el.navLogout) el.navLogout.classList.toggle('hidden', !loggedIn);
}

/**
 * Show toast notification
 */
function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', isError);
  el.toast.classList.remove('hidden', 'show');
  // Trigger reflow to restart animation
  el.toast.offsetHeight;
  el.toast.classList.add('show');
  setTimeout(() => {
    el.toast.classList.remove('show');
  }, 3000);
}

/**
 * Calculate total items in cart
 */
function getCartCount() {
  return state.cart.reduce((n, i) => n + (i.quantity || 1), 0);
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
 * Render bundles grid
 */
function renderBundles(bundles) {
  el.loading.classList.add('hidden');
  el.emptyState.classList.add('hidden');

  if (!bundles || bundles.length === 0) {
    el.emptyState.classList.remove('hidden');
    el.bundlesGrid.innerHTML = '';
    el.bundlesGrid.appendChild(el.emptyState);
    return;
  }

  el.bundlesGrid.innerHTML = bundles
    .map(
      (b) => `
    <article class="bundle-card ${escapeHtml(b.carrier || '').toLowerCase()}" data-id="${escapeHtml(b.id)}">
      <span class="bundle-carrier">${escapeHtml(b.carrier || 'Unknown')}</span>
      <h3 class="bundle-name">${escapeHtml(b.name || 'Unknown Bundle')}</h3>
      <p class="bundle-meta">${escapeHtml(b.data || 'N/A')} · ${escapeHtml(b.validity || 'N/A')}</p>
      <div class="bundle-footer">
        <span class="bundle-price">GHS ${(b.price || 0).toFixed(2)} <span>/ bundle</span></span>
        <button type="button" class="btn-add" data-id="${escapeHtml(b.id)}" data-carrier="${escapeHtml(b.carrier || '')}">Add</button>
      </div>
    </article>
  `
    )
    .join('');
}

/**
 * Fetch bundles from server with optional filters
 */
function fetchBundles() {
  const carrier = el.carrierFilter?.value || '';
  const validity = el.validityFilter?.value || '';
  const params = new URLSearchParams();

  if (carrier) params.set('carrier', carrier);
  if (validity) params.set('validity', validity);

  const qs = params.toString();
  const url = `${API_BASE}/api/bundles${qs ? '?' + qs : ''}`;

  el.loading.classList.remove('hidden');
  el.emptyState.classList.add('hidden');

  fetch(url)
    .then((r) => {
      if (!r.ok) {
        throw new Error('Failed to fetch bundles');
      }
      return r.json();
    })
    .then((data) => {
      state.bundles = data;
      data.forEach((b) => (state.bundlesById[b.id] = b));
      renderBundles(data);
    })
    .catch((err) => {
      console.error('Fetch bundles error:', err);
      el.loading.classList.add('hidden');
      el.emptyState.classList.remove('hidden');
      el.emptyState.textContent = 'Could not load bundles. Please try again.';
      el.bundlesGrid.appendChild(el.emptyState);
      showToast('Failed to load bundles', true);
    });
}

/**
 * Apply filters and fetch bundles
 */
function applyFilters() {
  fetchBundles();
}

/**
 * Update cart UI
 */
function updateCartUI() {
  const count = getCartCount();
  el.cartCount.textContent = count;
  el.cartCount.classList.toggle('hidden', count === 0);

  const hasItems = state.cart.length > 0;
  el.cartEmpty.classList.toggle('hidden', hasItems);
  el.cartFooter.classList.toggle('hidden', !hasItems);

  if (!hasItems) {
    el.cartList.innerHTML = '';
    return;
  }

  let total = 0;
  el.cartList.innerHTML = state.cart
    .map((item) => {
      const bundle = item.name ? item : state.bundlesById[item.id] || item;
      const qty = item.quantity || 1;
      const subtotal = (bundle.price || 0) * qty;
      total += subtotal;

      return `
        <li class="cart-item" data-id="${escapeHtml(item.id)}">
          <div class="cart-item-info">
            <h4>${escapeHtml(bundle.name || 'Unknown')}</h4>
            <span class="carrier">${escapeHtml(bundle.carrier || 'Unknown')}</span>
          </div>
          <div class="cart-item-right">
            <div class="cart-item-qty">
              <button type="button" data-action="minus" aria-label="Decrease">−</button>
              <span>${qty}</span>
              <button type="button" data-action="plus" aria-label="Increase">+</button>
            </div>
            <span class="cart-item-price">GHS ${subtotal.toFixed(2)}</span>
            <button type="button" class="cart-item-remove" data-action="remove" aria-label="Remove">×</button>
          </div>
        </li>
      `;
    })
    .join('');

  el.cartTotal.textContent = `GHS ${total.toFixed(2)}`;

  // Attach event listeners to cart item buttons
  $$('.cart-item', el.cartList).forEach((row) => {
    const id = row.dataset.id;
    row.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'minus') {
          const i = state.cart.findIndex((c) => c.id === id);
          if (i === -1) return;
          if (state.cart[i].quantity <= 1) {
            state.cart.splice(i, 1);
          } else {
            state.cart[i].quantity--;
          }
        } else if (action === 'plus') {
          const i = state.cart.findIndex((c) => c.id === id);
          if (i !== -1) state.cart[i].quantity = (state.cart[i].quantity || 1) + 1;
        } else if (action === 'remove') {
          state.cart = state.cart.filter((c) => c.id !== id);
        }
        updateCartUI();
      });
    });
  });
}

/**
 * Open cart drawer
 */
function openCart() {
  el.cartDrawer.setAttribute('aria-hidden', 'false');
  el.cartDrawer.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

/**
 * Close cart drawer
 */
function closeCart() {
  el.cartDrawer.setAttribute('aria-hidden', 'true');
  el.cartDrawer.classList.remove('is-open');
  document.body.style.overflow = '';
}

/**
 * Show checkout step (form or payment)
 */
function showCheckoutStep(step) {
  const isForm = step === 'form';
  el.checkoutStepForm?.classList.toggle('hidden', !isForm);
  el.checkoutStepPay?.classList.toggle('hidden', isForm);
  if (isForm) el.checkoutPhone?.focus();
}

/**
 * Open checkout modal
 */
function openCheckout() {
  if (state.cart.length === 0) {
    showToast('Your cart is empty', true);
    return;
  }

  closeCart();
  lastOrder = null;
  showCheckoutStep('form');
  renderCheckoutSummary();
  el.checkoutModal?.setAttribute('aria-hidden', 'false');
  el.checkoutModal?.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  // Pre-fill user data if logged in
  const user = getAuthUser();
  if (user) {
    if (user.phone) el.checkoutPhone.value = user.phone;
    if (user.name) el.checkoutName.value = user.name;
    if (user.email) el.checkoutEmail.value = user.email;
  }

  el.checkoutPhone?.focus();
}

/**
 * Close checkout modal
 */
function closeCheckout() {
  el.checkoutModal?.setAttribute('aria-hidden', 'true');
  el.checkoutModal?.classList.remove('is-open');
  document.body.style.overflow = '';
  showCheckoutStep('form');
  lastOrder = null;
}

/**
 * Render checkout order summary
 */
function renderCheckoutSummary() {
  let total = 0;
  const lines = state.cart.map((item) => {
    const b = item.name ? item : state.bundlesById[item.id] || item;
    const q = item.quantity || 1;
    const sub = (b.price || 0) * q;
    total += sub;
    return `${escapeHtml(b.name || 'Unknown')} × ${q} — GHS ${sub.toFixed(2)}`;
  });

  el.checkoutSummary.innerHTML = `
    <strong>Order summary</strong><br>
    ${lines.join('<br>')} <br>
    <strong>Total: GHS ${total.toFixed(2)}</strong>
  `;
}

/**
 * Add item to cart
 */
function addToCart(id) {
  const bundle = state.bundles.find((b) => b.id === id) || state.bundlesById[id];

  if (!bundle) {
    showToast('Bundle not found', true);
    return;
  }

  const existing = state.cart.find((c) => c.id === id);

  if (existing) {
    existing.quantity = (existing.quantity || 1) + 1;
  } else {
    state.cart.push({
      id: bundle.id,
      name: bundle.name,
      carrier: bundle.carrier,
      data: bundle.data,
      price: bundle.price,
      quantity: 1,
    });
  }

  updateCartUI();
  showToast(`${bundle.name} added to cart`);
}

/**
 * Validate Ghana phone number format
 */
function isValidPhone(phone) {
  const clean = String(phone).replace(/\s/g, '');
  return /^0\d{9}$/.test(clean);
}

/**
 * Place order
 */
function placeOrder(e) {
  e.preventDefault();

  const phone = el.checkoutPhone?.value.trim().replace(/\s/g, '') || '';
  const name = el.checkoutName?.value.trim() || null;
  const email = el.checkoutEmail?.value.trim() || null;

  if (!phone) {
    showToast('Please enter your phone number', true);
    return;
  }

  if (!isValidPhone(phone)) {
    showToast('Please enter a valid Ghana phone number (0XXXXXXXXX)', true);
    return;
  }

  const items = state.cart.map((c) => ({ id: c.id, quantity: c.quantity || 1 }));

  el.placeOrderBtn.disabled = true;
  el.placeOrderBtn.textContent = 'Placing order…';

  fetch(`${API_BASE}/api/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ items, phone, name, email }),
  })
    .then((r) => {
      if (!r.ok) {
        return r.json().then((data) => {
          throw new Error(data.error || 'Order failed');
        });
      }
      return r.json();
    })
    .then((data) => {
      if (data.success && data.order) {
        lastOrder = data.order;
        state.cart = [];
        updateCartUI();
        el.checkoutForm?.reset();
        el.payOrderId.textContent = escapeHtml(data.order.orderId);
        el.payAmount.textContent = 'GHS ' + (data.order.total || 0).toFixed(2);
        showCheckoutStep('pay');
        showToast('Order created. Proceed to payment.');
      } else {
        showToast(data.error || 'Order failed', true);
      }
    })
    .catch((err) => {
      console.error('Place order error:', err);
      showToast(err.message || 'Network error. Please try again.', true);
    })
    .finally(() => {
      el.placeOrderBtn.disabled = false;
      el.placeOrderBtn.textContent = 'Place order';
    });
}

/**
 * Initiate payment with Paystack
 */
function payNow() {
  if (!lastOrder) {
    showToast('No order found', true);
    return;
  }

  const orderId = lastOrder.orderId;
  const amount = lastOrder.total;
  const email = lastOrder.email || '';

  el.payNowBtn.disabled = true;
  el.payNowBtn.textContent = 'Redirecting…';

  fetch(`${API_BASE}/api/payment/initialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, email, amount }),
  })
    .then((r) => {
      if (!r.ok) {
        return r.json().then((data) => {
          throw new Error(data.error || 'Could not start payment');
        });
      }
      return r.json();
    })
    .then((data) => {
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
        return;
      }
      showToast(data.error || 'Could not start payment', true);
      el.payNowBtn.disabled = false;
      el.payNowBtn.textContent = 'Pay with Card or MoMo';
    })
    .catch((err) => {
      console.error('Payment init error:', err);
      showToast(err.message || 'Network error. Try again.', true);
      el.payNowBtn.disabled = false;
      el.payNowBtn.textContent = 'Pay with Card or MoMo';
    });
}

/**
 * Initialize page
 */
function init() {
  // Update navigation
  updateAuthNav();

  // Fetch initial bundles
  fetchBundles();
  updateCartUI();

  // Filter listeners
  el.carrierFilter?.addEventListener('change', applyFilters);
  el.validityFilter?.addEventListener('change', applyFilters);
  el.clearFilters?.addEventListener('click', () => {
    el.carrierFilter.value = '';
    el.validityFilter.value = '';
    applyFilters();
  });

  // Cart listeners
  el.cartBtn?.addEventListener('click', openCart);
  el.drawerBackdrop?.addEventListener('click', closeCart);
  el.drawerClose?.addEventListener('click', closeCart);
  el.checkoutBtn?.addEventListener('click', openCheckout);

  // Modal listeners
  el.modalBackdrop?.addEventListener('click', closeCheckout);
  el.modalClose?.addEventListener('click', closeCheckout);
  el.cancelCheckout?.addEventListener('click', closeCheckout);
  el.checkoutForm?.addEventListener('submit', placeOrder);
  el.payNowBtn?.addEventListener('click', payNow);

  // Logout
  el.navLogout?.addEventListener('click', function (e) {
    e.preventDefault();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    updateAuthNav();
    showToast('Logged out');
    setTimeout(() => {
      window.location.href = '/';
    }, 500);
  });

  // Bundle grid click handler
  el.bundlesGrid?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-add');
    if (btn) addToCart(btn.dataset.id);
  });

  // Check for checkout parameter
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === '1') {
    openCheckout();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}