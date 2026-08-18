# 06 · Media & Playback

The brief asked for one thing above all others: **video must display and play
correctly**, verified at both ends — that the extension scrapes the right link
and that the dashboard plays it smoothly. This document is that argument,
end to end.

It is a separate document because the media pipeline crosses every layer of
the project — content script, storage schema, normaliser, source selector,
three renderers and a viewer — and a defect anywhere in it produces the same
symptom: a black rectangle with a play button that does nothing. That symptom
is the worst possible outcome, because it is indistinguishable from a broken
network and it teaches the user not to trust the product.

---

## 1. The pipeline

```
x.com GraphQL response
   │
   ├─ content.js :: buildMediaItems()       ← capture. Runs on x.com.
   │     emits { type, url, poster, width, height, aspect,
   │             mp4, mp4_variants[], hls, duration, alt,
   │             sensitive, position }
   │
   ├─ chrome.storage.local  /  exported JSON
   │
   ├─ app.js :: normalizeMedia()            ← ingest. Runs in the dashboard.
   │     same shape, every URL passed through safeMediaUrl()
   │
   ├─ app.js :: mediaIndex()                ← flatten to one entry per item
   │
   └─ media.js :: playableSource() → createVideo()
                                             ← select and mount
```

Each hop is lossy if you let it be. Three fields were being dropped before
this redesign, and each loss was silent.

---

## 2. What X actually serves

For a single video, X publishes:

* **one poster frame** at `media_url_https` — which is *also* the field a
  photo uses for the photo itself;
* **an HLS playlist** (`.m3u8`), which X's own player prefers;
* **three or four fixed-bitrate MP4 variants**, typically around 250 kbps,
  830 kbps, 2.2 Mbps and 5 Mbps for the same content.

There is no resolution metadata on a variant. Bitrate is the only quality
signal, and the resolution in the URL path is not documented or guaranteed.

### 2.1 Why MP4 is preferred over HLS, always

Native HLS exists only in Safari and iOS WebKit. Chrome and Firefox need
hls.js, which is ~190 kB gzipped — more than the rest of this application put
together, in a repository that is deliberately zero-dependency and build-free.

Since X publishes an MP4 for essentially every video, the resolution is to
prefer the MP4 and use HLS only where the browser can play it unaided. That
covers the real corpus with zero bytes of dependency.

**`canPlayType` cannot be trusted here**, and this was established by testing
rather than assumed: Chromium answers `"maybe"` to both HLS MIME types and
then completely fails to play a playlist, because it needs Media Source
Extensions plus a library. Taking that answer at face value renders a play
button that leads to a dead player. `supportsNativeHls()` therefore treats
the claim as *necessary but not sufficient* and excludes Blink explicitly.

Sample item `190100000000000007` in `dashboard/bookmarks.json` is HLS-only on
purpose. It exists so the honest-failure path is exercised every time anyone
opens the sample library, rather than being discovered by a user.

---

## 3. The three fields that were being lost

### 3.1 The variant ladder

`buildMediaItems` used to sort the MP4 variants by bitrate, keep the winner,
and discard the rest. That made resolution selection structurally impossible
downstream: there was one URL, so every surface got the same one.

The consequence is invisible until you open a network panel. A rail of forty
videos, each rendered into a 168 px tile, was capable of pulling forty 720p
files. On a media-heavy library that is the single most expensive mistake the
product can make.

Now the whole ladder survives as `mp4_variants`, best-first, and
`playableSource(media, { width })` picks the smallest rung that still covers
the rendered width × DPR:

| Rendered at | DPR | Needs | Rung chosen |
|---|---|---|---|
| 168 px carousel tile | 2 | 336 px | 480p |
| 390 px phone stage | 3 → capped at 2 | 780 px | 720p |
| 900 px theater stage | 2 | 1800 px | 1080p |

DPR is capped at 2 deliberately. Beyond that the extra pixels are past the
point of visible return on video in a way they are not on text, and a 3× phone
would otherwise always pull the largest file.

The bitrate→width mapping in `approxWidth()` does not need to be exact. It
only has to *order* the rungs, and bitrate already does that. What matters is
the threshold: never serve a rung below the rendered size, because upscaling a
320p file into a 900 px player looks broken in a way that saving bytes cannot
justify.

### 3.2 The poster

For a photo, `media_url_https` is the photo. For a video, the same field is
the poster frame. Emitting it only as `url` meant every consumer had to know
that, and the ones that did not showed a grey box until the video was played —
which nobody does for a thumbnail they cannot see.

It is now emitted as `poster` as well, explicitly.

### 3.3 Sensitivity

`possibly_sensitive` is a property of the *post*, but the thing that has to
blur is the *media grid*. Making the grid reach back up to the post to find
out was a layering violation that guaranteed the blur would be forgotten in
at least one of the three renderers. The flag is now pushed down onto each
media item at capture time.

---

## 4. Playback behaviour

### 4.1 Posters only, until asked

No `<video>` element exists in any tile, in any view. A rail of forty videos
would otherwise mean forty media pipelines, forty network connections and a
tab that stalls on open. An `<img>` costs a decode; a `<video preload=metadata>`
costs a request *per item*, before anyone has expressed any interest at all.

This was the one performance decision worth carrying over from the previous
build, and it is now enforced by a test that fails if `<video` appears in
`tileHtml`.

### 4.2 One video at a time

Two videos playing at once is never what anyone wants and is trivially easy to
trigger in a scrolling feed. `M3EMedia.claimPlayback()` holds a single
`stopCurrent` reference; starting anything stops whatever was playing. Every
renderer calls `stopAll()` when it tears its DOM down, or a video keeps playing
from a detached node with no way to reach it.

### 4.3 Autoplay is a scroll position, not a click

In a media feed, "play" is where you are looking. `autoplayInView()` plays
whichever motion item is most central and pauses the rest, which is the
behaviour every video feed has trained people to expect.

Three constraints on it:

* **Muted, always.** A browser refuses to autoplay audible video anyway, and a
  wall of sound is hostile regardless of what the policy permits.
* **Off under reduced motion.** Someone who asked the OS to stop things moving
  has asked for exactly this. There is also an explicit *Autoplay in view*
  switch in Personalise, because bandwidth is a legitimate reason to want it
  off independent of motion sensitivity.
* **GIFs always loop.** A still frame of a looping GIF is an unreadable
  object; the loop *is* the content.

### 4.4 Theater tears players down

A paused `<video>` still holds a decoder and a buffer. A hundred of them is a
memory leak with extra steps. The theater's IntersectionObserver mounts a
player when a slide becomes centred and **removes the element entirely** when
it leaves, rather than pausing it.

### 4.5 Failure is handled, then admitted

A source that 404s or is codec-rejected fires `error` on the element and then
does nothing at all. `createVideo` attaches an error handler that:

1. steps down to the next rung of the MP4 ladder;
2. failing that, tries the HLS URL if the browser genuinely supports it;
3. failing that, calls `onFail`, and the surface replaces the player with a
   card that says what happened and offers **Watch on X**.

An honest dead end beats a black rectangle. The user can always get to the
thing they saved, even when this tool cannot render it.

---

## 5. Where playback is verified

Automated, in `tests/`:

* `run-tests.mjs` — the scraper emits the full ladder, the poster, the
  sensitivity flag and stable positions, from a real captured GraphQL fixture.
* `media.test.mjs` — MP4 beats HLS; Chromium's false `"maybe"` is disbelieved;
  `hlsOnly` flags exactly the unplayable case; aspect ratios clamp; the
  normaliser preserves every field playback depends on.
* `browse.test.mjs` — rung selection by rendered width; the error handler
  steps down the ladder; autoplay is muted; tiles contain no `<video>`;
  theater removes rather than pauses; `stopAll` is called by every surface.

Manually, in a real Chromium build against the sample library, all four
motion paths were driven and confirmed:

| Path | Result |
|---|---|
| Theater, video centred | mounts, `readyState 4`, playing, muted, 1280×720 decoded |
| Viewer opened from a grid tile | mounts, `readyState 4`, playing, native controls present |
| HLS-only item, either surface | honest fallback card + working "Watch on X" link |
| GIF in any view | loops silently in place, no controls |

---

## 6. What is deliberately not here

**No custom control bar.** The browser's own controls are already
keyboard-complete, screen-reader labelled, and bring picture-in-picture and
fullscreen for free. A hand-built control bar is a large amount of code whose
best possible outcome is parity. What the design system supplies is the
frame — shape, surface, focus ring — not a reimplementation.

**No hls.js.** See §2.1. The cost is one sample-sized class of video that
Chrome cannot play; the alternative is tripling the size of the application
for it.

**No thumbnail generation.** X's poster frames are good and free. Decoding
video client-side to make our own would be slower, worse, and would require
the video download this whole design exists to avoid.
