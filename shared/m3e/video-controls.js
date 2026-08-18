/* =============================================================================
   M3E · Theater video controls

   A thin, custom control layer over the native <video> element, built for the
   theater's one-video-at-a-time architecture rather than for a generic
   embedded player. Native controls are deliberately replaced here (createVideo
   is called with `controls: false`) because the theater needs its own rules:
   controls that feel like part of the slide, hide while playing, scrub without
   paging the carousel, and remember where you left off.

   The layer is intentionally small and app-shaped:

     · play / pause          · mute / unmute
     · seek + time           · loop toggle
     · playback rate         · picture-in-picture
     · resume position       · auto-hide chrome
     · buffering state       · reduced-motion respect

   Persistence is not this module's job: it asks for `{ get, set, clear }` per
   entry and calls them at the right moments. The dashboard decides what
   "save progress" means (and where), which keeps the controller reusable and
   testable without a storage backend.

   Exposed as window.M3EVideoControls.bind(video, options) → cleanup.
   ============================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.M3EVideoControls = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ICONS = {
    play: '<path d="M8 5v14l11-7L8 5Z"/>',
    pause: '<path d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z"/>',
    volume: '<path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12ZM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77Z"/>',
    muted: '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.42.05-.63Zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71ZM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3ZM12 4 9.91 6.09 12 8.18V4Z"/>',
    loop: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7Zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4Z"/>',
    pip: '<path d="M19 11h-8v6h8v-6Zm4 8V4.98C23 3.88 22.1 3 21 3H3C1.9 3 1 3.88 1 4.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2Zm-2 .02H3V4.97h18v14.05Z"/>',
  };

  const svg = (name, size) =>
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" aria-hidden="true" fill="currentColor">' + (ICONS[name] || "") + "</svg>";

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const HIDE_DELAY = 2500;
  const SAVE_INTERVAL = 1000; // ms between throttled progress saves
  const RESUME_MIN = 3;       // seconds watched before a position is worth keeping
  const RESUME_MAX = 0.95;    // fraction of the way through before we give up

  function formatTime(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {object} options
   * @param {HTMLElement} options.container   the stage the controls overlay
   * @param {string} [options.entryId]        media entry id for resume
   * @param {{get,set,clear}} [options.progress] resume persistence
   * @returns {Function} cleanup — save progress, drop listeners, remove DOM
   */
  function bind(video, options) {
    const opts = options || {};
    const container = opts.container;
    if (!video || !container) return function () {};

    const entryId = opts.entryId || null;
    const progress = opts.progress || null;

    /* ---- DOM ---------------------------------------------------------------- */
    const bar = document.createElement("div");
    bar.className = "slide__controls";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Video controls");

    const seek = document.createElement("input");
    seek.type = "range";
    seek.className = "slide__seek";
    seek.min = "0";
    seek.max = "0";
    seek.step = "0.1";
    seek.value = "0";
    seek.disabled = true;
    seek.setAttribute("aria-label", "Seek");

    const row = document.createElement("div");
    row.className = "slide__controls-row";

    const playBtn = makeButton("play", "Pause", "play");

    const time = document.createElement("span");
    time.className = "slide__time m3e-label-medium";
    const cur = document.createElement("span");
    cur.textContent = "0:00";
    const dur = document.createElement("span");
    dur.textContent = "0:00";
    time.appendChild(cur);
    time.appendChild(document.createTextNode(" / "));
    time.appendChild(dur);

    const spacer = document.createElement("span");
    spacer.className = "slide__controls-spacer";

    const muteBtn = makeButton("mute", "Mute", "muted");
    const loopBtn = makeButton("loop", "Loop", "loop");
    const rateBtn = makeButton("rate", "Playback speed", null);
    rateBtn.classList.add("slide__rate");
    rateBtn.textContent = "1×";
    const pipBtn = makeButton("pip", "Enter picture-in-picture", "pip");

    row.appendChild(playBtn);
    row.appendChild(time);
    row.appendChild(spacer);
    row.appendChild(muteBtn);
    row.appendChild(loopBtn);
    row.appendChild(rateBtn);
    row.appendChild(pipBtn);
    bar.appendChild(seek);
    bar.appendChild(row);

    const spinner = document.createElement("div");
    spinner.className = "slide__buffering";
    spinner.hidden = true;

    const resume = document.createElement("div");
    resume.className = "slide__resume";
    resume.hidden = true;
    const resumeText = document.createElement("span");
    const resumeRestart = document.createElement("button");
    resumeRestart.type = "button";
    resumeRestart.className = "m3e-button m3e-button--text m3e-button--s m3e-state";
    resumeRestart.textContent = "Start over";
    resume.appendChild(resumeText);
    resume.appendChild(resumeRestart);

    container.appendChild(spinner);
    container.appendChild(bar);
    container.appendChild(resume);

    const pipSupported =
      typeof document !== "undefined" && document.pictureInPictureEnabled &&
      typeof video.requestPictureInPicture === "function";
    if (!pipSupported) pipBtn.hidden = true;

    /* ---- state -------------------------------------------------------------- */
    let visible = false;
    let scrubbing = false;
    let buffering = false;
    let hideTimer = null;
    let resumeTimer = null;
    let lastSave = 0;

    const duration = () => (Number.isFinite(video.duration) ? video.duration : 0);
    const isMuted = () => video.muted || video.volume === 0;

    function makeButton(action, label, icon) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "m3e-icon-button m3e-state slide__control";
      b.setAttribute("data-action", action);
      b.setAttribute("aria-label", label);
      if (icon) b.innerHTML = svg(icon, 20);
      return b;
    }

    /* ---- sync ---------------------------------------------------------------- */
    function syncTime() {
      const d = duration();
      seek.disabled = !d;
      if (d) seek.max = String(d);
      if (!scrubbing) seek.value = String(video.currentTime || 0);
      cur.textContent = formatTime(video.currentTime);
      dur.textContent = d ? formatTime(d) : "--:--";
      const pos = scrubbing ? Number(seek.value) : video.currentTime;
      seek.style.setProperty("--_played", d ? String((pos / d) * 100) : "0");
    }

    function syncPlay() {
      const playing = !video.paused && !video.ended;
      playBtn.innerHTML = svg(playing ? "pause" : "play", 20);
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }

    function syncMute() {
      const muted = isMuted();
      muteBtn.innerHTML = svg(muted ? "muted" : "volume", 20);
      muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      muteBtn.setAttribute("aria-pressed", String(muted));
    }

    function syncRate() {
      rateBtn.textContent = video.playbackRate === 1 ? "1×" : video.playbackRate + "×";
    }

    function syncPiP() {
      const on = document.pictureInPictureElement === video;
      pipBtn.setAttribute("aria-label", on ? "Exit picture-in-picture" : "Enter picture-in-picture");
      pipBtn.setAttribute("aria-pressed", String(on));
    }

    /* ---- visibility ---------------------------------------------------------- */
    function show() {
      bar.classList.add("is-visible");
      visible = true;
      scheduleHide();
    }

    function hide() {
      // Never vanish while the reader still needs it.
      if (scrubbing || buffering || video.paused || video.ended) return;
      if (bar.contains(document.activeElement)) return;
      bar.classList.remove("is-visible");
      visible = false;
    }

    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HIDE_DELAY);
    }

    function setBuffering(on) {
      buffering = on;
      spinner.hidden = !on;
      if (on) { clearTimeout(hideTimer); show(); }
      else scheduleHide();
    }

    /* ---- resume persistence -------------------------------------------------- */
    function saveProgress(force) {
      if (!progress || !entryId) return;
      const d = duration();
      const t = video.currentTime;
      if (!d) return;
      const now = Date.now();
      if (!force && now - lastSave < SAVE_INTERVAL) return;
      lastSave = now;
      // Under three seconds in, or essentially finished: nothing worth keeping.
      if (t < RESUME_MIN || t > d * RESUME_MAX) { progress.clear(entryId); return; }
      progress.set(entryId, { t, d, at: now });
    }

    function clearProgress() {
      if (progress && entryId) progress.clear(entryId);
    }

    function tryResume() {
      if (!progress || !entryId) return;
      const saved = progress.get(entryId);
      if (!saved || !saved.t) return;
      const d = duration();
      if (!d || saved.t < RESUME_MIN || saved.t > d * RESUME_MAX) return;
      video.currentTime = saved.t;
      resumeText.textContent = "Resumed from " + formatTime(saved.t);
      resume.hidden = false;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { resume.hidden = true; }, 4000);
    }

    /* ---- events -------------------------------------------------------------- */
    seek.addEventListener("input", () => {
      const d = duration();
      if (!d) return;
      const t = Number(seek.value);
      video.currentTime = t;
      cur.textContent = formatTime(t);
      seek.style.setProperty("--_played", String((t / d) * 100));
    });
    seek.addEventListener("pointerdown", () => { scrubbing = true; clearTimeout(hideTimer); });
    ["pointerup", "pointercancel", "change"].forEach((evName) =>
      seek.addEventListener(evName, () => { scrubbing = false; scheduleHide(); })
    );

    playBtn.addEventListener("click", () => {
      if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
      else video.pause();
    });

    muteBtn.addEventListener("click", () => {
      video.muted = !video.muted;
      if (video.muted) video.volume = Math.max(0.01, video.volume || 1); // keep a sensible level to restore
      syncMute();
    });

    loopBtn.addEventListener("click", () => {
      video.loop = !video.loop;
      loopBtn.setAttribute("aria-pressed", String(video.loop));
    });

    rateBtn.addEventListener("click", () => {
      const i = RATES.indexOf(video.playbackRate);
      video.playbackRate = RATES[(i + 1) % RATES.length];
      syncRate();
    });

    pipBtn.addEventListener("click", () => {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
      else video.requestPictureInPicture().catch(() => {});
    });

    resumeRestart.addEventListener("click", () => {
      clearProgress();
      resume.hidden = true;
      video.currentTime = 0;
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    });

    /* Tapping the media reveals the controls first, then toggles play/pause.
       A horizontal swipe is not a tap: pointer movement above a few pixels is
       treated as the carousel's gesture and ignored. */
    let downX = 0;
    let downY = 0;
    const onPointerDown = (event) => {
      if (event.target.closest(".slide__controls, .slide__resume, .slide__buffering")) return;
      downX = event.clientX;
      downY = event.clientY;
    };
    const onClick = (event) => {
      if (event.target.closest(".slide__controls, .slide__resume, .slide__buffering")) return;
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      if (moved > 6) return;
      if (!visible) { show(); return; }
      if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
      else video.pause();
    };
    const onPointerMove = () => { if (!video.paused) show(); };
    const onPointerLeave = () => hide();

    /* Stop the carousel's dismiss/scroll from swallowing gestures that begin
       on the controls — the seek bar must scrub, never page the theater. */
    const onBarPointerDown = (event) => event.stopPropagation();

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("click", onClick);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
    bar.addEventListener("pointerdown", onBarPointerDown);

    bar.addEventListener("focusin", () => { clearTimeout(hideTimer); show(); });
    bar.addEventListener("focusout", () => scheduleHide());

    video.addEventListener("loadedmetadata", () => { syncTime(); tryResume(); });
    video.addEventListener("durationchange", syncTime);
    video.addEventListener("timeupdate", () => { syncTime(); saveProgress(); });
    video.addEventListener("progress", () => {
      const d = duration();
      if (!d || !video.buffered.length) return;
      const end = video.buffered.end(video.buffered.length - 1);
      seek.style.setProperty("--_buffered", String(Math.min(1, end / d) * 100));
    });
    video.addEventListener("play", () => { syncPlay(); scheduleHide(); });
    video.addEventListener("pause", () => { syncPlay(); saveProgress(true); show(); });
    video.addEventListener("ended", () => { syncPlay(); saveProgress(true); show(); });
    video.addEventListener("waiting", () => setBuffering(true));
    video.addEventListener("playing", () => setBuffering(false));
    video.addEventListener("canplay", () => setBuffering(false));
    video.addEventListener("ratechange", syncRate);
    video.addEventListener("volumechange", syncMute);
    video.addEventListener("enterpictureinpicture", syncPiP);
    video.addEventListener("leavepictureinpicture", syncPiP);

    const onPageHide = () => saveProgress(true);
    if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);

    /* ---- initial state ------------------------------------------------------- */
    syncTime();
    syncPlay();
    syncMute();
    syncRate();
    loopBtn.setAttribute("aria-pressed", String(video.loop));
    show();

    /* ---- cleanup ------------------------------------------------------------- */
    let done = false;
    return function cleanup() {
      if (done) return;
      done = true;
      clearTimeout(hideTimer);
      clearTimeout(resumeTimer);
      saveProgress(true);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("click", onClick);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      bar.removeEventListener("pointerdown", onBarPointerDown);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
      [spinner, bar, resume].forEach((el) => el.remove());
    };
  }

  return { bind };
});
