/* =============================================================================
   Smart lenses

   Computed views over the media index. They are not folders, tags, or
   anything the user files into — each one is a predicate over a media item
   and the little bit of local state a browser already keeps (openedAt,
   resume progress). The tag system failed because it asked people to
   organise. These never do.

   Pure: no DOM, no storage. The dashboard supplies the current time, the
   post's openedAt, a precomputed engagement cutoff, and any resume record.
   ============================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XBMLenses = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CAPTURED_WINDOW_MS = 14 * 864e5;
  const LONG_VIDEO_MS = 30e3;
  const PORTRAIT_ASPECT = 0.9;
  const WIDE_ASPECT = 1.7;
  const FORGOTTEN_AGE_MS = 30 * 864e5;
  const FORGOTTEN_IDLE_MS = 60 * 864e5;

  const isVideo = (m) => !!m && m.type === "video";
  const isGif = (m) => !!m && m.type === "animated_gif";
  const isPhoto = (m) => !!m && !isVideo(m) && !isGif(m);

  /** Unclamped aspect. Presentation clamps; lenses must not, or a 9:19
      screenshot and a 1:1 still collapse to the same bucket. */
  function mediaAspect(media) {
    const stored = Number(media && media.aspect);
    if (Number.isFinite(stored) && stored > 0) return stored;
    const w = Number(media && media.width) || 0;
    const h = Number(media && media.height) || 0;
    return w && h ? w / h : 16 / 9;
  }

  /** Same rate the "Best engagement" sort uses, so the lens and the sort
      agree about what "high" means. */
  function engagementScore(item) {
    if (!item) return 0;
    const likes = Number(item.likes) || 0;
    const replies = Number(item.replies) || 0;
    const views = Number(item.views) || 0;
    if (views > 0) return ((likes + replies * 2) / views) * 1000;
    return likes;
  }

  /** 75th percentile of a score list, floored at 1 so an all-zero library
      does not call everything a hit. */
  function engagementCutoff(scores) {
    const list = (scores || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
    if (!list.length) return Number.POSITIVE_INFINITY;
    const at = Math.max(0, Math.min(list.length - 1, Math.floor(list.length * 0.75)));
    return Math.max(list[at], 1);
  }

  /**
   * Does this media item belong in the named lens?
   *
   * `ctx` is supplied by the dashboard so this stays a pure function:
   *   now        epoch ms
   *   openedAt   ISO string or null — last time the post was opened
   *   cutoff     engagement threshold (only consulted by "engagement")
   *   progress   resume record `{ t }` or null
   */
  function matches(id, media, item, ctx) {
    const now = (ctx && ctx.now) || 0;
    const openedAt = ctx && ctx.openedAt;
    switch (id) {
      case "all":
      case "archived":
        return true;
      case "video":
        return !isPhoto(media);
      case "photos":
        return isPhoto(media);
      case "recent":
        return !!openedAt;
      case "unseen":
        return !openedAt;
      case "captured": {
        const seen = item && item._seen ? Number(item._seen) : 0;
        return seen > 0 && now - seen <= CAPTURED_WINDOW_MS;
      }
      case "engagement":
        return engagementScore(item) >= ((ctx && ctx.cutoff) || Number.POSITIVE_INFINITY);
      case "long":
        return isVideo(media) && (Number(media.duration) || 0) >= LONG_VIDEO_MS;
      case "portrait":
        return isPhoto(media) && mediaAspect(media) < PORTRAIT_ASPECT;
      case "wide":
        return isPhoto(media) && mediaAspect(media) >= WIDE_ASPECT;
      case "alt":
        return !!(media && media.alt && String(media.alt).trim());
      case "forgotten": {
        const posted = item && item._ts ? Number(item._ts) : 0;
        if (!posted || now - posted < FORGOTTEN_AGE_MS) return false;
        if (openedAt) {
          const opened = new Date(openedAt).getTime();
          if (Number.isFinite(opened) && now - opened < FORGOTTEN_IDLE_MS) return false;
        }
        return true;
      }
      case "gifs":
        return isGif(media);
      case "resume":
        return !!(ctx && ctx.progress && Number(ctx.progress.t) > 0);
      default:
        return true;
    }
  }

  return {
    CAPTURED_WINDOW_MS,
    LONG_VIDEO_MS,
    PORTRAIT_ASPECT,
    WIDE_ASPECT,
    FORGOTTEN_AGE_MS,
    FORGOTTEN_IDLE_MS,
    isVideo,
    isGif,
    isPhoto,
    mediaAspect,
    engagementScore,
    engagementCutoff,
    matches,
  };
});
