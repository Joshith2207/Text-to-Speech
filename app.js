/* =====================================================
   Speak — Text to Speech App
   Uses the Web Speech API (SpeechSynthesis)
   Compatible: Chrome, Edge, Firefox, Safari, Opera

   BROWSER QUIRKS HANDLED:
   1. Chrome: voices load async → onvoiceschanged
   2. Chrome: cancel() needs ~150ms delay before speak()
   3. Chrome: speechSynthesis silently stalls on long text →
      keepalive setInterval calls pause()+resume() every 10s
   4. Chrome: SpeechSynthesisUtterance gets GC'd if not kept
      in module scope → stored in `currentUtterance`
===================================================== */

(function () {
  'use strict';

  // Kept at module scope to prevent garbage collection (Chrome bug)
  let currentUtterance = null;
  let keepaliveTimer   = null;

  // ── Browser support check ─────────────────────────────
  const badge = document.getElementById('support-badge');
  if (!('speechSynthesis' in window)) {
    badge.textContent = 'Not Supported';
    badge.classList.add('unsupported');
    document.getElementById('btn-speak').disabled = true;
    setStatus('Your browser does not support the Web Speech API. Try Chrome or Edge.', 'error');
    return;
  }
  badge.textContent = 'Supported';
  badge.classList.add('supported');

  // ── DOM refs ──────────────────────────────────────────
  const textarea      = document.getElementById('tts-input');
  const charCur       = document.getElementById('char-current');
  const voiceSel      = document.getElementById('voice-select');
  const rateRange     = document.getElementById('rate-range');
  const rateVal       = document.getElementById('rate-value');
  const pitchRange    = document.getElementById('pitch-range');
  const pitchVal      = document.getElementById('pitch-value');
  const volRange      = document.getElementById('volume-range');
  const volVal        = document.getElementById('volume-value');
  const btnSpeak      = document.getElementById('btn-speak');
  const btnPause      = document.getElementById('btn-pause');
  const btnStop       = document.getElementById('btn-stop');
  const btnClear      = document.getElementById('btn-clear');
  const progressTrack = document.getElementById('progress-track');
  const progressBar   = document.getElementById('progress-bar');
  const statusText    = document.getElementById('status-text');
  const logoIcon      = document.querySelector('.logo-icon');

  // ── State ─────────────────────────────────────────────
  let voices        = [];
  let isPaused      = false;
  let progressTimer = null;
  let startTime     = 0;
  let estimatedMs   = 0;

  // ── Status helper ─────────────────────────────────────
  function setStatus(msg, type) {
    statusText.textContent = msg;
    statusText.className   = 'status-text' + (type ? ' ' + type : '');
  }

  // ── Voice loading ─────────────────────────────────────
  function loadVoices() {
    const v = window.speechSynthesis.getVoices();
    if (!v.length) return;

    const prevName = voiceSel.selectedOptions[0]
      ? voiceSel.selectedOptions[0].dataset.name : '';

    voices = v;
    voiceSel.innerHTML = '';

    // English voices first, then all others
    const sorted = [
      ...voices.filter(x => x.lang.startsWith('en')),
      ...voices.filter(x => !x.lang.startsWith('en')),
    ];

    sorted.forEach((voice, i) => {
      const opt = document.createElement('option');
      opt.value        = i;
      opt.dataset.name = voice.name;
      opt.dataset.lang = voice.lang;
      opt.textContent  = voice.name + ' (' + voice.lang + ')';
      if (voice.default) opt.selected = true;
      voiceSel.appendChild(opt);
    });

    // Restore previous selection
    if (prevName) {
      const match = [...voiceSel.options].find(o => o.dataset.name === prevName);
      if (match) match.selected = true;
    }
  }

  function getSelectedVoice() {
    if (!voices.length) return null;
    const sorted = [
      ...voices.filter(x => x.lang.startsWith('en')),
      ...voices.filter(x => !x.lang.startsWith('en')),
    ];
    return sorted[voiceSel.selectedIndex]
      || voices.find(v => v.default)
      || voices[0]
      || null;
  }

  // Load voices immediately (Firefox/Safari) and via event (Chrome)
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;

  // ── Char counter ──────────────────────────────────────
  textarea.addEventListener('input', () => {
    charCur.textContent = textarea.value.length;
  });

  // ── Range live display ────────────────────────────────
  rateRange.addEventListener('input',  () => { rateVal.textContent  = parseFloat(rateRange.value).toFixed(1) + '×'; });
  pitchRange.addEventListener('input', () => { pitchVal.textContent = parseFloat(pitchRange.value).toFixed(1); });
  volRange.addEventListener('input',   () => { volVal.textContent   = Math.round(parseFloat(volRange.value) * 100) + '%'; });

  // ── Progress ──────────────────────────────────────────
  function estimateDuration(text, rate) {
    const words = text.trim().split(/\s+/).length;
    return (words / (150 * rate)) * 60 * 1000;
  }

  function startProgress(durationMs) {
    clearInterval(progressTimer);
    progressTrack.classList.add('visible');
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '0%';
    startTime   = Date.now();
    estimatedMs = durationMs;
    progressTimer = setInterval(() => {
      const pct = Math.min(((Date.now() - startTime) / estimatedMs) * 100, 99);
      progressBar.style.width = pct + '%';
      if (pct >= 99) clearInterval(progressTimer);
    }, 100);
  }

  function finishProgress() {
    clearInterval(progressTimer);
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '100%';
    setTimeout(() => {
      progressTrack.classList.remove('visible');
      progressBar.style.width = '0%';
    }, 500);
  }

  function resetProgress() {
    clearInterval(progressTimer);
    progressTrack.classList.remove('visible');
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '0%';
  }

  // ── Keepalive: prevents Chrome stalling on long texts ─
  function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
  }

  function stopKeepalive() {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }

  // ── SVG snippets ──────────────────────────────────────
  const SVG_PAUSE = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="6" y="4" width="4" height="16" fill="currentColor" rx="1"/>
    <rect x="14" y="4" width="4" height="16" fill="currentColor" rx="1"/>
  </svg>`;
  const SVG_RESUME = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <polygon points="5,3 19,12 5,21" fill="currentColor"/>
  </svg>`;

  // ── Button state helpers ──────────────────────────────
  function setSpeakingState() {
    btnSpeak.disabled  = true;
    btnPause.disabled  = false;
    btnStop.disabled   = false;
    btnPause.innerHTML = SVG_PAUSE + 'Pause';
    isPaused = false;
    logoIcon.classList.add('speaking');
  }

  function setIdleState() {
    btnSpeak.disabled  = false;
    btnPause.disabled  = true;
    btnStop.disabled   = true;
    btnPause.innerHTML = SVG_PAUSE + 'Pause';
    isPaused = false;
    logoIcon.classList.remove('speaking');
  }

  function setPausedState() {
    btnPause.innerHTML = SVG_RESUME + 'Resume';
    isPaused = true;
    logoIcon.classList.remove('speaking');
  }

  function setResumedState() {
    btnPause.innerHTML = SVG_PAUSE + 'Pause';
    isPaused = false;
    logoIcon.classList.add('speaking');
  }

  // ── Speak ─────────────────────────────────────────────
  btnSpeak.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) {
      setStatus('Please type something first.', 'error');
      textarea.focus();
      return;
    }

    stopKeepalive();
    window.speechSynthesis.cancel();

    // CRITICAL: Chrome needs ~150ms after cancel() before speak() works
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      currentUtterance = utterance; // prevent GC

      const voice = getSelectedVoice();
      if (voice) {
        utterance.voice = voice;
        utterance.lang  = voice.lang;
      }

      utterance.rate   = parseFloat(rateRange.value);
      utterance.pitch  = parseFloat(pitchRange.value);
      utterance.volume = parseFloat(volRange.value);

      utterance.onstart = () => {
        setSpeakingState();
        setStatus('Speaking…', 'active');
        startProgress(estimateDuration(text, utterance.rate));
        startKeepalive();
      };

      utterance.onend = () => {
        stopKeepalive();
        setIdleState();
        setStatus('Done ✓');
        finishProgress();
        currentUtterance = null;
      };

      utterance.onerror = (e) => {
        stopKeepalive();
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        setIdleState();
        setStatus('Error: ' + e.error, 'error');
        resetProgress();
        currentUtterance = null;
      };

      utterance.onpause  = () => { setPausedState();  setStatus('Paused'); };
      utterance.onresume = () => { setResumedState(); setStatus('Speaking…', 'active'); };

      window.speechSynthesis.speak(utterance);
    }, 150);
  });

  // ── Pause / Resume ────────────────────────────────────
  btnPause.addEventListener('click', () => {
    if (!isPaused) {
      window.speechSynthesis.pause();
      stopKeepalive();
    } else {
      window.speechSynthesis.resume();
      startKeepalive();
    }
  });

  // ── Stop ──────────────────────────────────────────────
  btnStop.addEventListener('click', () => {
    stopKeepalive();
    window.speechSynthesis.cancel();
    setIdleState();
    setStatus('Stopped');
    resetProgress();
    currentUtterance = null;
  });

  // ── Clear ─────────────────────────────────────────────
  btnClear.addEventListener('click', () => {
    stopKeepalive();
    window.speechSynthesis.cancel();
    textarea.value      = '';
    charCur.textContent = '0';
    setIdleState();
    setStatus('Ready');
    resetProgress();
    textarea.focus();
    currentUtterance = null;
  });

  // ── Ctrl/Cmd + Enter to speak ─────────────────────────
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!btnSpeak.disabled) btnSpeak.click();
    }
  });

  // ── Auto-pause when tab hides ─────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      stopKeepalive();
      setPausedState();
      setStatus('Paused (tab hidden)');
    }
  });

  setStatus('Ready');

})();
