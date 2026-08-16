# 03 · Layout & Navigation

## 1. Window classes

M3's five adaptive breakpoints, applied as `html[data-window-class]` by
`M3E.bindWindowClass()` so both CSS and JS agree on the current class.

| Class | Width | Navigation | Content | Detail |
|---|---|---|---|---|
| **compact** | ≤ 599 | Bottom nav bar (4 items) + FAB menu | Single pane, 1 column | Modal bottom sheet |
| **medium** | 600–839 | Navigation rail | Single pane, 1 column | Modal side sheet |
| **expanded** | 840–1199 | Navigation rail | Single pane, **2-column grid** | Modal side sheet |
| **large** | 1200–1599 | Navigation rail | List + detail, 420 px pane | **Persistent pane** |
| **extra-large** | ≥ 1600 | Navigation rail | List + detail, 480 px pane | **Persistent pane** |

```
compact                medium / expanded         large / extra-large
┌──────────────┐       ┌───┬─────────────┐       ┌───┬────────┬────────┐
│   app bar    │       │ r │  app bar    │       │ r │ app bar│        │
├──────────────┤       │ a ├─────────────┤       │ a ├────────┤ detail │
│              │       │ i │             │       │ i │        │        │
│   content    │       │ l │   content   │       │ l │ content│ (always│
│              │       │   │             │       │   │        │  there)│
├──────────────┤       └───┴─────────────┘       └───┴────────┴────────┘
│  nav bar     │
└──────────────┘
```

The transition at 1200 px is the significant one: below it the detail view is
*modal* (scrim, focus trap, Escape closes); at and above it the detail view is
*part of the page* (no scrim, no trap, selection persists while you keep
browsing the list). These are genuinely different interaction models, not one
layout stretched.

## 2. Navigation model

Five collections, mapped to the rail and nav bar:

| Collection | Meaning |
|---|---|
| **All** | Everything not archived |
| **Unread** | Never opened |
| **Tagged** | Has at least one tag |
| **Media** | Contains photo, video or GIF |
| **Archive** | Explicitly archived |

The compact nav bar shows the first four — M3 caps a navigation bar at 3–5
destinations, and Archive is the least frequent, so it moves into the overflow
rather than crowding the bar.

Collections are **filters over one library**, not folders. Nothing is ever in
two places or lost from a place; the same post can be Unread *and* Media *and*
Tagged. This is the model that matches how people actually treat a bookmark
pile.

## 3. Information architecture

```
Library (collection)
  └ Filters      media · links · tagged · noted · author · likes · reposts · dates
      └ Sort     newest · oldest · captured · likes · reposts · replies · original order
          └ Results
              └ Post detail
                  ├ full text, media, quoted post
                  ├ engagement at capture
                  ├ links
                  ├ tags        (user-authored)
                  ├ private note (user-authored)
                  └ identifiers  (post, conversation, reply-to)
```

Every filter and sort choice is mirrored into the URL (`?c=&sort=&q=&author=…`),
so a filtered view is linkable, bookmarkable and survives a refresh. For a tool
about keeping things, losing your place on reload would be an odd failure.

## 4. Density

`comfortable` (default) and `compact` scale row gaps, card padding and the text
clamp (6 lines → 3) — **not** font size. A power user with 4 000 bookmarks gets
more rows per screen without giving up legibility.

## 5. Responsive behaviour worth calling out

- **Hero at compact** — sheds its caption, shrinks its numeral, and scrolls its
  stats horizontally, so a full bookmark card is visible above the fold.
- **Filter bar** — scrolls horizontally only below 600 px; wraps above.
- **Bottom padding at compact** — reserves 168 px so neither the nav bar nor
  the FAB floating above it can cover the last card.
- **App bar** — sheds the brand mark from 600 px up (the rail owns it) but
  **keeps the `<h1>`**, which names the current collection. Every page needs a
  visible, programmatic heading; an earlier draft dropped it on desktop, which
  left the page titleless for screen readers.
- **Print** — a dedicated block strips rail, nav bar, FAB, detail pane and
  filter chips, leaving the library as a readable document.

## 6. Keyboard model

| Key | Action |
|---|---|
| `/` | Focus search |
| `Escape` | Close detail → clear search |
| `1`–`5` | Jump to collection |
| `s` | Shuffle (or re-deal the current shuffle) |
| `↑` / `↓` | Rove between cards |
| `Enter` | Open focused card |
| `Tab` | Standard order; skip link first |
| `←` `→` `Home` `End` `z` | Lightbox: navigate, jump, zoom |

Card roving uses a roving tabindex so the list is a single tab stop, not one
stop per card — with 4 000 bookmarks, per-card tab stops would make the page
untraversable by keyboard.
