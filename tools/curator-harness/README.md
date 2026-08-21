# Curator harness

Two node scripts that exercise `extension/dashboard/js/curator.js` without a
browser. They are the evidence behind §8.4 of
`docs/design/m3-expressive-dashboard.md`.

```
node tools/curator-harness/synthetic-libraries.mjs   # 7 / 45 / 180 / 2400 items
node tools/curator-harness/edge-cases.mjs            # empty, bare, archived, single-author
```

`synthetic-libraries.mjs` reports, per library size: how many shelves were
selected, how many unique items reached the screen, the average number of times
an item is repeated across shelves (the number the old engine got wrong — it was
around 4), the worst single-author share on a thematic rail, and whether the page
is stable within a day and rotates across days.

`edge-cases.mjs` checks the degenerate inputs curate must survive: an empty
library, one item, items with no author/text/dates, an all-archived library, and
a library where one account wrote everything.

Neither script has dependencies; they load the curator with `eval` against a
stub `window`, because the module is a browser script rather than an ES module.
