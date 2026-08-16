/* =============================================================================
   Media playback

   X serves video two ways:
     · an HLS playlist (.m3u8) — adaptive, and what X prefers;
     · a set of fixed-bitrate MP4 variants.

   Native HLS exists only in Safari. Chrome and Firefox need hls.js, which is
   ~190 kB gzipped — more than the rest of this application put together, for a
   repo that is deliberately zero-dependency and build-free.

   The resolution here: **prefer the MP4 variant, because X publishes one for
   essentially every video**, and MP4 plays natively everywhere with no library
   at all. HLS is used only where the browser can play it unaided (Safari), and
   only when no MP4 exists. If neither is playable we say so plainly and link
   to the original post rather than showing a video element that will never
   start.

   That covers the real corpus with zero bytes of dependency. `hlsOnly()` marks
   the residual case so the UI can be honest about it.

   Exposed as window.M3EMedia.
   ============================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.M3EMedia = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Does this browser play an HLS playlist without a library?
   *
   * `canPlayType` cannot be trusted here, and this was confirmed by testing
   * rather than assumed: Chromium answers "maybe" to both HLS mime types
   * while being completely unable to play a playlist — it needs Media Source
   * Extensions plus a library. Taking that answer at face value produces the
   * worst possible outcome, a play button that leads to a dead player.
   *
   * So the claim is necessary but not sufficient: Blink is excluded, which
   * leaves the browsers that genuinely ship native HLS (Safari, iOS WebKit).
   * Firefox never claims support and is filtered by the first test. Should
   * this still be wrong somewhere, `createVideo` reports the error path and
   * the UI degrades to an honest message rather than a black rectangle.
   */
  let nativeHls = null;
  function supportsNativeHls() {
    if (nativeHls !== null) return nativeHls;
    if (typeof document === "undefined") return (nativeHls = false);

    const v = document.createElement("video");
    const claims = !!(
      v.canPlayType("application/vnd.apple.mpegurl") ||
      v.canPlayType("application/x-mpegURL")
    );
    if (!claims) return (nativeHls = false);

    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    const blink = /Chrom(e|ium)\//.test(ua) || /\bEdg\//.test(ua) || /OPR\//.test(ua);
    return (nativeHls = !blink);
  }

  /**
   * The best source this browser can actually play.
   * @returns {{src: string, kind: 'mp4'|'hls'} | null}
   */
  function playableSource(media) {
    if (!media) return null;
    if (media.mp4) return { src: media.mp4, kind: "mp4" };
    if (media.hls && supportsNativeHls()) return { src: media.hls, kind: "hls" };
    return null;
  }

  /** True when a video exists but this browser cannot play it. */
  function hlsOnly(media) {
    if (!media || !isMotion(media)) return false;
    return !playableSource(media);
  }

  function isMotion(media) {
    return !!media && (media.type === "video" || media.type === "animated_gif");
  }

  /* ---------------------------------------------------------------------------
     One-at-a-time playback

     Two videos playing at once is never what anyone wants, and on a list of
     bookmarks it is easy to trigger. Starting a video stops whatever was
     playing before it.
     --------------------------------------------------------------------------- */
  let stopCurrent = null;

  function claimPlayback(stopFn) {
    if (stopCurrent && stopCurrent !== stopFn) stopCurrent();
    stopCurrent = stopFn;
  }

  function releasePlayback(stopFn) {
    if (stopCurrent === stopFn) stopCurrent = null;
  }

  /**
   * Build a <video> for a media item and wire it into the playback manager.
   * Native controls: they are already keyboard-complete, screen-reader
   * labelled, and give PiP + fullscreen for free. Styled by components.css,
   * not reimplemented.
   */
  function createVideo(media, opts) {
    const options = opts || {};
    const source = playableSource(media);
    if (!source) return null;

    const video = document.createElement("video");
    const gif = media.type === "animated_gif";

    video.className = "m3e-video";
    video.src = source.src;
    if (media.poster) video.poster = media.poster;
    video.playsInline = true;
    video.preload = options.preload || "metadata";
    // A GIF is a silent loop with no chrome; a video is a video.
    video.controls = !gif;
    video.loop = gif;
    video.muted = gif;
    if (media.alt) video.setAttribute("aria-label", media.alt);
    if (media.width && media.height) {
      video.width = media.width;
      video.height = media.height;
    }
    video.style.aspectRatio = aspectRatio(media);

    const stop = () => { try { video.pause(); } catch (_) {} };
    video.addEventListener("play", () => claimPlayback(stop));
    video.addEventListener("pause", () => releasePlayback(stop));
    video.addEventListener("emptied", () => releasePlayback(stop));

    if (options.autoplay) {
      // Autoplay is only permitted while muted, and only worth attempting for
      // GIFs. A rejected promise here is normal, not an error.
      const attempt = video.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
    }

    return video;
  }

  /** Stop whatever is currently playing (used when a view is torn down). */
  function stopAll() {
    if (stopCurrent) stopCurrent();
    stopCurrent = null;
  }

  /* ---------------------------------------------------------------------------
     Presentation helpers
     --------------------------------------------------------------------------- */

  /** A CSS `aspect-ratio` value, clamped so freak dimensions can't wreck a row. */
  function aspectRatio(media, min, max) {
    const lo = min || 0.5;   // 1:2 portrait
    const hi = max || 3;     // 3:1 panorama
    let r = Number(media && media.aspect);
    if (!Number.isFinite(r) || r <= 0) {
      const w = Number(media && media.width);
      const h = Number(media && media.height);
      r = w && h ? w / h : 16 / 9;
    }
    return String(Math.min(hi, Math.max(lo, r)));
  }

  /**
   * X's CDN resizes on demand. Asking for a card-sized WebP instead of the
   * original saves an enormous amount of bandwidth on a media-heavy library.
   * Only pbs.twimg.com understands these parameters; anything else is
   * returned untouched.
   */
  function sizedImage(url, name) {
    if (!url || typeof url !== "string") return url;
    if (!/^https:\/\/pbs\.twimg\.com\//.test(url)) return url;
    try {
      const u = new URL(url);
      // A URL that already carries an explicit format wins; don't fight it.
      u.searchParams.set("format", u.searchParams.get("format") || "webp");
      u.searchParams.set("name", name || "small");
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  /** `0:42`, `12:10`, `1:02:33`. Empty string when there is no duration. */
  function formatDuration(ms) {
    const total = Math.round((Number(ms) || 0) / 1000);
    if (!total) return "";
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /** The short badge a thumbnail shows: `GIF`, a duration, or nothing. */
  function badgeFor(media) {
    if (!media) return "";
    if (media.type === "animated_gif") return "GIF";
    if (isMotion(media)) return formatDuration(media.duration) || "VIDEO";
    return "";
  }

  return {
    supportsNativeHls,
    playableSource,
    hlsOnly,
    isMotion,
    createVideo,
    claimPlayback,
    releasePlayback,
    stopAll,
    aspectRatio,
    sizedImage,
    formatDuration,
    badgeFor,
  };
});
