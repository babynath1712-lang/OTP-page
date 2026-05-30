/* ============================================
   NEXORA OTP VERIFICATION — JAVASCRIPT
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ─────────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────────── */
  const OTP_LENGTH     = 6;
  const TIMER_DURATION = 120; // seconds (2 min)
  const RESEND_COOLDOWN = 60; // seconds
  // Demo: any 6-digit code starting with "123" passes; "000000" triggers expired state
  const DEMO_VALID_PREFIX = '123';

  /* ─────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────── */
  let timerInterval   = null;
  let resendInterval  = null;
  let timerRemaining  = TIMER_DURATION;
  let resendRemaining = RESEND_COOLDOWN;
  let currentMethod   = 'email';

  /* ─────────────────────────────────────────────
     DOM REFERENCES
  ───────────────────────────────────────────── */
  const digitInputs      = Array.from(document.querySelectorAll('.otp-digit'));
  const submitBtn        = document.getElementById('otp-submit');
  const progressBar      = document.getElementById('otp-progress-bar');
  const countdownEl      = document.getElementById('otp-countdown');
  const timerWrap        = document.getElementById('otp-timer-wrap');
  const resendBtn        = document.getElementById('otp-resend-btn');
  const resendCooldown   = document.getElementById('otp-resend-cooldown');
  const resendCount      = document.getElementById('otp-resend-count');
  const inlineError      = document.getElementById('otp-inline-error');
  const otpTarget        = document.getElementById('otp-target');
  const methodBtns       = document.querySelectorAll('.otp-method-btn');
  const expiredResendBtn = document.getElementById('expired-resend-btn');

  /* ─────────────────────────────────────────────
     INITIAL SETUP
  ───────────────────────────────────────────── */
  // Retrieve target from URL or sessionStorage
  const urlParams = new URLSearchParams(window.location.search);
  const requestedEmail = urlParams.get('email') || sessionStorage.getItem('otp_email') || 'user@example.com';
  const requestedPhone = urlParams.get('phone') || sessionStorage.getItem('otp_phone') || '+1 234-567-8900';

  function maskEmail(email) {
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 2) return `${name[0]}***@${domain}`;
    return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}@${domain}`;
  }

  const targets = {
    email: maskEmail(requestedEmail),
    sms: requestedPhone.slice(0, 3) + ' ****-***-' + requestedPhone.slice(-3)
  };

  if (otpTarget) otpTarget.textContent = targets[currentMethod];

  // Focus first digit on load
  setTimeout(() => digitInputs[0]?.focus(), 600);

  startTimer();
  startResendCooldown();

  /* ─────────────────────────────────────────────
     OTP DIGIT INPUT LOGIC
  ───────────────────────────────────────────── */
  digitInputs.forEach((input, idx) => {

    /* --- keydown: handle backspace, arrows, delete --- */
    input.addEventListener('keydown', (e) => {
      clearInlineError();

      if (e.key === 'Backspace') {
        e.preventDefault();
        if (input.value) {
          input.value = '';
          updateFillState(input, false);
          updateProgress();
          updateSubmitState();
        } else if (idx > 0) {
          const prev = digitInputs[idx - 1];
          prev.value = '';
          updateFillState(prev, false);
          prev.focus();
          updateProgress();
          updateSubmitState();
        }
      }

      if (e.key === 'ArrowLeft'  && idx > 0) { e.preventDefault(); digitInputs[idx-1].focus(); }
      if (e.key === 'ArrowRight' && idx < OTP_LENGTH-1) { e.preventDefault(); digitInputs[idx+1].focus(); }

      if (e.key === 'Delete') {
        input.value = '';
        updateFillState(input, false);
        updateProgress();
        updateSubmitState();
      }

      if (e.key === 'Enter' && isComplete()) {
        verifyOTP();
      }
    });

    /* --- input: handle typing --- */
    input.addEventListener('input', (e) => {
      clearInlineError();

      const raw  = e.target.value.replace(/\D/g, '');
      const char = raw.slice(-1);

      if (!char) {
        input.value = '';
        updateFillState(input, false);
        updateProgress();
        updateSubmitState();
        return;
      }

      input.value = char;
      updateFillState(input, true);
      updateProgress();
      updateSubmitState();

      // Auto-advance
      if (idx < OTP_LENGTH - 1) {
        digitInputs[idx + 1].focus();
      } else {
        // All filled — auto-submit after tiny delay
        input.blur();
        setTimeout(() => {
          if (isComplete()) verifyOTP();
        }, 180);
      }
    });

    /* --- paste: spread digits across boxes --- */
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      clearInlineError();
      const pasted = (e.clipboardData || window.clipboardData)
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, OTP_LENGTH);

      if (!pasted) return;

      // Distribute starting from current index
      let filledCount = 0;
      for (let i = 0; i < pasted.length && idx + i < OTP_LENGTH; i++) {
        digitInputs[idx + i].value = pasted[i];
        updateFillState(digitInputs[idx + i], true);
        filledCount++;
      }

      // Focus next empty or last filled
      const nextIdx = Math.min(idx + pasted.length, OTP_LENGTH - 1);
      digitInputs[nextIdx].focus();

      updateProgress();
      updateSubmitState();

      if (isComplete()) {
        setTimeout(() => verifyOTP(), 180);
      }
    });

    /* --- focus: select content for easy re-entry --- */
    input.addEventListener('focus', () => {
      setTimeout(() => input.select(), 0);
    });
  });

  /* ─────────────────────────────────────────────
     FILL STATE HELPER
  ───────────────────────────────────────────── */
  function updateFillState(input, filled) {
    input.classList.toggle('filled', filled);
    input.classList.remove('error', 'success');
  }

  /* ─────────────────────────────────────────────
     PROGRESS BAR
  ───────────────────────────────────────────── */
  function updateProgress() {
    const filled = digitInputs.filter(i => i.value).length;
    const pct    = (filled / OTP_LENGTH) * 100;
    if (progressBar) progressBar.style.width = `${pct}%`;
  }

  /* ─────────────────────────────────────────────
     SUBMIT STATE
  ───────────────────────────────────────────── */
  function isComplete() {
    return digitInputs.every(i => i.value.match(/^\d$/));
  }

  function updateSubmitState() {
    if (submitBtn) submitBtn.disabled = !isComplete();
  }

  /* ─────────────────────────────────────────────
     COUNTDOWN TIMER
  ───────────────────────────────────────────── */
  function startTimer() {
    timerRemaining = TIMER_DURATION;
    updateTimerDisplay();

    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      timerRemaining--;
      updateTimerDisplay();

      if (timerRemaining <= 30) timerWrap?.classList.add('expiring-soon');
      if (timerRemaining <= 0) {
        clearInterval(timerInterval);
        timerWrap?.classList.add('expired');
        timerWrap?.classList.remove('expiring-soon');
        showStep('step-expired');
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    if (!countdownEl) return;
    const m = Math.floor(timerRemaining / 60).toString().padStart(2, '0');
    const s = (timerRemaining % 60).toString().padStart(2, '0');
    countdownEl.textContent = `${m}:${s}`;
  }

  /* ─────────────────────────────────────────────
     RESEND COOLDOWN
  ───────────────────────────────────────────── */
  function startResendCooldown() {
    resendRemaining = RESEND_COOLDOWN;
    if (resendBtn) resendBtn.disabled = true;
    if (resendCooldown) {
      resendCooldown.style.display = 'inline';
      if (resendCount) resendCount.textContent = resendRemaining;
    }

    if (resendInterval) clearInterval(resendInterval);

    resendInterval = setInterval(() => {
      resendRemaining--;
      if (resendCount) resendCount.textContent = resendRemaining;

      if (resendRemaining <= 0) {
        clearInterval(resendInterval);
        if (resendBtn)     resendBtn.disabled = false;
        if (resendCooldown) resendCooldown.style.display = 'none';
      }
    }, 1000);
  }

  /* ─────────────────────────────────────────────
     VERIFY OTP
  ───────────────────────────────────────────── */
  function verifyOTP() {
    if (!isComplete()) return;

    const code = digitInputs.map(i => i.value).join('');

    // Lock inputs during verification
    digitInputs.forEach(i => { i.disabled = true; });
    setSubmitLoading(submitBtn, true);

    setTimeout(() => {
      digitInputs.forEach(i => { i.disabled = false; });
      setSubmitLoading(submitBtn, false);

      // Demo logic: code "000000" → expired, starts with DEMO_VALID_PREFIX → success, else error
      if (code === '000000') {
        clearInterval(timerInterval);
        showStep('step-expired');
        return;
      }

      if (code.startsWith(DEMO_VALID_PREFIX)) {
        // Mark all as success
        digitInputs.forEach(i => { i.classList.add('success'); i.classList.remove('filled', 'error'); });
        clearInterval(timerInterval);
        clearInterval(resendInterval);
        setTimeout(() => {
          showStep('step-success');
          launchConfetti();
        }, 400);
      } else {
        // Wrong code — shake and show error
        digitInputs.forEach(i => {
          i.classList.add('error');
          i.classList.remove('filled');
          // re-trigger animation
          void i.offsetWidth;
        });
        showInlineError('Incorrect code. Try again or request a new one.');
        // Clear inputs and re-focus
        setTimeout(() => {
          digitInputs.forEach(i => {
            i.value = '';
            i.classList.remove('error', 'filled');
          });
          updateProgress();
          updateSubmitState();
          digitInputs[0].focus();
        }, 700);
      }
    }, 1600);
  }

  // Manual submit button click
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      if (isComplete()) verifyOTP();
    });
  }

  /* ─────────────────────────────────────────────
     RESEND BUTTON
  ───────────────────────────────────────────── */
  if (resendBtn) {
    resendBtn.addEventListener('click', () => {
      resendBtn.disabled = true;
      // Clear digits
      digitInputs.forEach(i => {
        i.value = '';
        i.classList.remove('filled', 'error', 'success');
      });
      updateProgress();
      updateSubmitState();
      clearInlineError();

      // Animate: brief "sending" state
      const textEl = resendBtn.querySelector('.otp-resend-text');
      if (textEl) {
        const orig = textEl.textContent;
        textEl.textContent = 'Sending…';
        setTimeout(() => { textEl.textContent = orig; }, 1200);
      }

      setTimeout(() => {
        showToast('A new code has been sent!');
        startTimer();
        startResendCooldown();
        digitInputs[0].focus();
      }, 1200);
    });
  }

  /* ─────────────────────────────────────────────
     EXPIRED PAGE — RESEND
  ───────────────────────────────────────────── */
  if (expiredResendBtn) {
    expiredResendBtn.addEventListener('click', () => {
      setSubmitLoading(expiredResendBtn, true);

      setTimeout(() => {
        setSubmitLoading(expiredResendBtn, false);
        // Reset and go back to verify step
        digitInputs.forEach(i => {
          i.value = '';
          i.classList.remove('filled', 'error', 'success');
        });
        updateProgress();
        updateSubmitState();
        timerWrap?.classList.remove('expired', 'expiring-soon');
        clearInlineError();
        showStep('step-verify');
        startTimer();
        startResendCooldown();
        showToast('A new code has been sent!');
        setTimeout(() => digitInputs[0].focus(), 300);
      }, 1600);
    });
  }

  /* ─────────────────────────────────────────────
     METHOD SWITCH (Email / SMS)
  ───────────────────────────────────────────── */
  methodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      methodBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMethod = btn.dataset.method;

      if (otpTarget) otpTarget.textContent = targets[currentMethod];

      // Clear and restart
      digitInputs.forEach(i => {
        i.value = '';
        i.classList.remove('filled', 'error', 'success');
      });
      updateProgress();
      updateSubmitState();
      clearInlineError();
      startTimer();
      startResendCooldown();
      showToast(`Code sent via ${currentMethod === 'email' ? 'Email' : 'SMS'}!`);
      setTimeout(() => digitInputs[0].focus(), 400);
    });
  });

  /* ─────────────────────────────────────────────
     PARALLAX ORBS
  ───────────────────────────────────────────── */
  const orbs = document.querySelectorAll('.orb');
  window.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth  - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    orbs.forEach((orb, i) => {
      const s = (i + 1) * 10;
      orb.style.transform = `translate(${x * s}px, ${y * s}px)`;
    });
  }, { passive: true });

  /* ─────────────────────────────────────────────
     CONFETTI (lightweight canvas)
  ───────────────────────────────────────────── */
  function launchConfetti() {
    const canvas = document.getElementById('otp-confetti');
    if (!canvas) return;

    const card = canvas.closest('.otp-card');
    canvas.width  = card.offsetWidth;
    canvas.height = card.offsetHeight;

    const ctx = canvas.getContext('2d');
    const COLORS = ['#818cf8','#a78bfa','#6366f1','#34d399','#06b6d4','#f472b6','#fbbf24'];
    const pieces = Array.from({ length: 80 }, () => ({
      x:    Math.random() * canvas.width,
      y:    -10 - Math.random() * 80,
      w:    5 + Math.random() * 6,
      h:    3 + Math.random() * 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      angle: Math.random() * Math.PI * 2,
      spin:  (Math.random() - 0.5) * 0.2,
      vx:   (Math.random() - 0.5) * 3,
      vy:   2 + Math.random() * 3,
      alpha: 1,
    }));

    let frame = 0;
    const MAX_FRAMES = 90;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      pieces.forEach(p => {
        p.x     += p.vx;
        p.y     += p.vy;
        p.angle += p.spin;
        p.vy    += 0.06; // gravity
        if (frame > 50) p.alpha = Math.max(0, p.alpha - 0.025);

        if (p.y < canvas.height + 20 && p.alpha > 0) alive = true;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      frame++;
      if (alive && frame < MAX_FRAMES) {
        requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    requestAnimationFrame(draw);
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */
  function showStep(id) {
    document.querySelectorAll('.otp-card').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
  }

  function showInlineError(msg) {
    if (!inlineError) return;
    inlineError.textContent = msg;
    inlineError.classList.add('visible');
  }

  function clearInlineError() {
    if (!inlineError) return;
    inlineError.textContent = '';
    inlineError.classList.remove('visible');
  }

  function setSubmitLoading(btn, loading) {
    if (!btn) return;
    const textEl   = btn.querySelector('.otp-btn-text');
    const loaderEl = btn.querySelector('.otp-btn-loader');
    btn.disabled = loading;
    if (textEl)   textEl.style.display   = loading ? 'none' : '';
    if (loaderEl) loaderEl.style.display = loading ? 'flex' : 'none';
  }

  function showToast(msg) {
    let toast = document.getElementById('otp-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'otp-toast';
      Object.assign(toast.style, {
        position: 'fixed', top: '28px', right: '28px', zIndex: '200',
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '13px 20px',
        background: 'rgba(17,17,24,0.92)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(52,211,153,0.22)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        fontSize: '0.86rem', color: '#34d399', fontWeight: '500',
        fontFamily: "'Inter', sans-serif",
        transform: 'translateX(calc(100% + 40px))',
        transition: 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1)',
      });
      toast.innerHTML = `
        <span style="width:22px;height:22px;border-radius:50%;background:rgba(52,211,153,0.15);
                     display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.8rem">✓</span>
        <span class="toast-msg"></span>
      `;
      document.body.appendChild(toast);
    }
    toast.querySelector('.toast-msg').textContent = msg;
    toast.style.transform = 'translateX(0)';
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => {
      toast.style.transform = 'translateX(calc(100% + 40px))';
    }, 3200);
  }

  console.log('🔐 Nexora OTP Verification Loaded');
  console.log('💡 Demo: Enter any 6-digit code starting with 123 to succeed, 000000 to trigger expiry, anything else to fail.');
});
