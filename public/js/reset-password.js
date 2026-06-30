(function () {
  const API_BASE = '';
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const passwordStrengthEl = document.getElementById('passwordStrength');
  const submitBtn = document.getElementById('submitBtn');
  const errorMessageEl = document.getElementById('errorMessage');
  const resetFormEl = document.getElementById('resetForm');
  const invalidLinkEl = document.getElementById('invalidLink');
  const passwordResetForm = document.getElementById('passwordResetForm');

  /**
   * Get reset token from URL parameters
   */
  function getResetToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  }

  /**
   * Show error message
   */
  function showError(message) {
    errorMessageEl.textContent = message;
    errorMessageEl.classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Clear error message
   */
  function clearError() {
    errorMessageEl.classList.remove('show');
  }

  /**
   * Check if password is strong
   */
  function isStrongPassword(password) {
    return (
      typeof password === 'string' &&
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /\d/.test(password)
    );
  }

  /**
   * Check password strength and update UI
   */
  function updatePasswordStrength() {
    const password = newPasswordInput.value;

    if (!password) {
      passwordStrengthEl.textContent = '';
      passwordStrengthEl.className = 'password-strength';
      return;
    }

    let strength = 0;
    const checks = [];

    if (password.length >= 8) {
      strength++;
      checks.push('✓ At least 8 characters');
    }
    if (/[a-z]/.test(password)) {
      strength++;
      checks.push('✓ Contains lowercase letter');
    }
    if (/[A-Z]/.test(password)) {
      strength++;
      checks.push('✓ Contains uppercase letter');
    }
    if (/\d/.test(password)) {
      strength++;
      checks.push('✓ Contains number');
    }
    if (/[!@#$%^&*()_+\-=\[\]{};:'",.<>?\/\\|`~]/.test(password)) {
      strength++;
      checks.push('✓ Contains special character');
    }

    let strengthClass = 'weak';
    let strengthText = '⚠ Weak password';

    if (strength >= 4) {
      strengthClass = 'good';
      strengthText = '✓ Strong password';
    } else if (strength >= 3) {
      strengthClass = 'fair';
      strengthText = '↗ Fair password';
    }

    passwordStrengthEl.className = `password-strength ${strengthClass}`;
    passwordStrengthEl.innerHTML = `<strong>${strengthText}</strong><br>${checks.join('<br>')}`;
  }

  /**
   * Validate that passwords match
   */
  function validatePasswordsMatch() {
    if (newPasswordInput.value !== confirmPasswordInput.value) {
      return false;
    }
    return true;
  }

  /**
   * Handle form submission
   */
  passwordResetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const password = newPasswordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();
    const token = getResetToken();

    // Validation
    if (!token) {
      showError('Invalid reset link. Please request a new password reset.');
      return;
    }

    if (!password || !confirmPassword) {
      showError('Please enter and confirm your new password');
      return;
    }

    if (password !== confirmPassword) {
      showError('Passwords do not match');
      return;
    }

    if (!isStrongPassword(password)) {
      showError('Password must be at least 8 characters and include uppercase, lowercase, and a number');
      return;
    }

    // Submit to server
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="loading-spinner"></span>Resetting password...';

    try {
      const response = await fetch(API_BASE + '/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      if (data.success) {
        // Redirect to success page
        window.location.href = '/pages/success.html';
      } else {
        showError(data.error || 'Password reset failed');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    } catch (error) {
      console.error('Reset password error:', error);
      showError(error.message || 'Network error. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  /**
   * Update password strength on input
   */
  newPasswordInput.addEventListener('input', updatePasswordStrength);

  /**
   * Check match status on confirm password input
   */
  confirmPasswordInput.addEventListener('input', () => {
    if (newPasswordInput.value && confirmPasswordInput.value) {
      if (validatePasswordsMatch()) {
        clearError();
      }
    }
  });

  /**
   * Initialize page
   */
  function init() {
    const token = getResetToken();

    if (!token) {
      resetFormEl.style.display = 'none';
      invalidLinkEl.style.display = 'block';
    } else {
      resetFormEl.style.display = 'block';
      invalidLinkEl.style.display = 'none';
      newPasswordInput.focus();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
