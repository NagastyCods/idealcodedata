(function () {
  const form = document.getElementById('contactForm');
  const submitBtn = document.getElementById('contactSubmit');
  const feedback = document.getElementById('contactFeedback');

  function showFeedback(message, isError) {
    feedback.textContent = message;
    feedback.className = 'contact-feedback ' + (isError ? 'error' : 'success');
    feedback.classList.remove('hidden');
  }

  function hideFeedback() {
    feedback.classList.add('hidden');
  }

  form?.addEventListener('submit', function (e) {
    e.preventDefault();
    hideFeedback();
    const name = document.getElementById('contactName').value.trim();
    const email = document.getElementById('contactEmail').value.trim();
    const message = document.getElementById('contactMessage').value.trim();
    if (!name || !email || !message) {
      showFeedback('Please fill in all fields.', true);
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (r.ok) {
            showFeedback('Message sent. We\'ll get back to you soon.');
            form.reset();
          } else {
            showFeedback(data.error || 'Something went wrong. Please try again.', true);
          }
        });
      })
      .catch(function () {
        showFeedback('Could not send message. Please try again.', true);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send message';
      });
  });

  if (localStorage.getItem('idealdata_token')) {
    const navAccount = document.getElementById('navAccount');
    const navLogin = document.getElementById('navLogin');
    const navLogout = document.getElementById('navLogout');
    if (navAccount) navAccount.classList.remove('hidden');
    if (navLogin) navLogin.classList.add('hidden');
    if (navLogout) navLogout.classList.remove('hidden');
  } else {
    const navAccount = document.getElementById('navAccount');
    const navLogin = document.getElementById('navLogin');
    const navLogout = document.getElementById('navLogout');
    if (navAccount) navAccount.classList.add('hidden');
    if (navLogin) navLogin.classList.remove('hidden');
    if (navLogout) navLogout.classList.add('hidden');
  }
})();
