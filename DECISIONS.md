# Decisions

Assumptions made where the build prompt was open, and suggestions that were deliberately not built.

## General

- **State.** The Zustand store has the fields from the spec plus two transient ones: `draft` (step 2 work in progress, so going back never loses it) and `job` (worker progress or error).
- **Locking.** Completed steps stay clickable in the stepper and show a read-only summary with an Edit button. Only Edit invalidates anything, and it confirms first when there is something to lose.
- **Editing dimensions** discards an uploaded or drawn design as well as the map, because it was cropped or drawn for one specific grid. A segment design is kept, since its rules fit it to the new size.
- **Editing the design draft** after "Continue" makes step 3 unavailable until "Continue" is pressed again, so step 3 can never show a stale image.
- **Re-running color detection** discards manual color edits, so it asks first when there are any.
- **UI skill.** The UI skill's search scripts were not installed on the build machine, so only its written checklist was used, together with the spec's visual direction.
- **Font.** IBM Plex Sans (Latin only), bundled, for its tabular figures. No network requests.

## Step 1 — Dimensions

- Starts at 9 × 12 ft, 10 × 10 knots per inch, in ft + in.
- Width, height, warp and weft are the stored values; everything else is derived from them.
- While a field holds invalid text, the derived values keep showing the last valid state and the lock button is disabled.
- "Actual" size notes appear when rounding changes a side by 0.005 in or more.
- **Hard limit:** 25 million knots, 16,384 per side. Browsers cannot hold larger canvases reliably. 24.6 million was tested (about 12 s to generate). Everything else outside the realistic ranges is only a soft warning.
- The rug's proportions come from the *actual* size, after rounding to whole knots.

## Step 2 — Design

- **Upload**
  - Images under 32 px on a side are rejected as too small. Fewer pixels than knots is only a warning.
  - Proportions within 0.5% of the rug's count as matching; the whole image is then used without a crop frame.
  - The crop is kept at its own resolution up to 4000 px on the long side (up to 8192 px when the knot grid itself is larger than 4000).
  - Transparent areas become white.
- **Draw**
  - Canvas resolution is exactly 1 × the knot grid (along the denser direction), capped at 4000 px.
  - Tools paint hard edges without anti-aliasing, and bucket fill matches exact color. Anti-aliased edges would otherwise show up in the knot map as extra yarn colors.
  - With square knots every drawn pixel is one knot. With non-square knots the less dense direction is averaged, so a few blended edge colors are possible.
  - The eraser paints white, which is the canvas color.
  - "Continue" needs at least one mark on the canvas.
  - Undo keeps up to 60 steps or 40 million changed pixels, whichever comes first.
- The transform hook (`DesignSource`, `DesignTransform`, `runDesignPipeline`) is in `src/domain/pipeline.ts`; `transforms` is `[]`.

## Step 4 — Knot map

- Area averaging is done in linear light (physically correct color mixing), then converted to OKLab.
- Random choices are seeded, so the same design and settings always give the same map.
- The default minimum color difference is 0.05 in OKLab; the slider runs from 0 to 0.2.
- "Number of colors" is an upper limit. The merge pass, or a design with few colors, can give fewer.
- After merging, centroids are not re-averaged, because that could move two of them back within the minimum difference.
- Fine blended edges in uploaded images can form small clusters of their own (a fraction of a percent of knots). Fewer colors or a higher minimum difference absorbs them.
- The minimum difference applies to detection only. Manually chosen colors may be alike.
- Color IDs are C01, C02, … in order of knot count.
- Rows are numbered from the top and columns from the left, starting at 1. Heavy lines fall after every 10th knot.
- Grid lines appear from 6 px per knot. Below one screen pixel per knot the map is smoothed, since nearest-pixel scaling would drop knots.
- When a pale color is highlighted the other knots dim towards dark; otherwise towards light.

## Step 5 — Rug preview

- The warp ends are always the top and bottom, because warp is counted across the width. On a rug that is wider than it is long, these are the long sides.
- **Pile look.** Follows a reference image supplied after the first build, and replaces the spec's rounded, shaded cell per knot: irregular horizontal dashes in wavy rows, with red, green and blue moved by equal amounts. Contrast, dash length, row height and the stronger sheen on dark yarn were fitted to that image.
- **Same look at every zoom.** Texture rows stay at least 5 px tall on screen. When knots are smaller than that, one texture row stands for 2, 4, 8… knot rows; otherwise one texture row is one knot row.
- **Color edges flow** between knots instead of showing square cells. Each pixel takes the yarn with the most weight among the nearest 3 × 3 knots. This is for looks only; the knot map itself is unchanged.
- The 2–4% lightness jitter per knot is kept under the texture.
- The preview is drawn in a worker, a little larger than the view. While a new picture is on its way, the last one is stretched into place.
- Maximum zoom is 24 px per knot (64 in the knot map); closer than that the pile turns soft.
- The preview uses the edited palette.

## Segments, resizing and saving

Added on request; the original spec excluded saving and pattern rules.

### How the requested options became inputs

| Asked for | Input |
|---|---|
| Shape segment with its own color and logic | Border, fill or motif, each with a color, artwork and rules |
| Drawn or taken from an image | Draw (the same tools, on a transparent canvas) or Picture (drag over a part, optionally removing its background color) |
| Repeat along the corner | Border, with mitred, plain or own-artwork corners; or a motif at all four corners |
| Minimum and maximum length | Shortest (left out below this) and Longest (never grows past this) |
| Minimum and maximum stretch | Least and Most stretch of one piece |
| Repeat on X, repeat on Y | A fill has separate rules for each direction |
| Allowed padding before another line | Space between, and the most it may grow before one is added |
| (added) | Mirror every other piece; crop or stretch when the limits can't be met |

### Rules

- Order of preference: pieces stay at 100% while gaps grow up to their limit; then the count changes, choosing whichever number squeezes or stretches the pieces least; only then is the segment cropped or stretched past its limits.
- Mirrored pieces are added in pairs. When they are cropped, a whole pair stays in the middle.
- Border inset and thickness do not change with the rug.
- Motifs grow in proportion to the room they are in, within their limits.
- In the knot map, pieces start and end on whole knots.
- "Split a rug picture" finds bands where the average color changes with distance from the edge, and the length of a repeat by comparing each band with itself shifted. Bands that do not clearly repeat become a mirrored half side. All four sides use the top side's artwork, and all four corners the top-left one's.

### Resizing

- Available once there is a knot map. Warp and weft stay the same, so the number of knots changes.
- Colors are never detected again: each knot takes the nearest color of the existing palette, so color edits carry over.
- Designs without segments stretch, or are cropped at the edges. Cropping enlarges the pattern only when the rug grows past the design.
- Every resize starts from the original design, so repeated resizing does not wear it out.

### Saving

- Kept in this browser (IndexedDB) with the rules, artwork, colors, map and size. There is no file or cloud copy; clearing the browser's site data removes it.

## Export

Added on request after the first build; the original spec excluded exports. Files are built in a worker and use the current, edited palette.

- **Knot map, PDF.** One page. Knots are at most 12 pt on their shorter side, less when the page would pass 14,400 pt (200 in), the largest side PDF readers accept. Cells and grid lines are vector shapes, so they stay sharp at any zoom. Heavier line every 10 knots, numbers on all four sides, color key on top.
- **Knot map, Excel.** One filled cell per knot, frozen row and column numbers, and a second sheet with the color key. Limited to 5 million knots; larger workbooks are not practical to open.
- Map cells have the knot's real proportions, so the design is not stretched.
- **Rug, PNG or JPG.** About 40 megapixels, at most 10,000 px per side and 16 px per knot, on white with the fringe and without the shadow. A broad second texture layer is added so the pattern does not visibly repeat when the whole rug is seen at once.
- No PDF or spreadsheet library is used; both writers are small and tested by decoding their output.

## Running

- `npm install`, then `npm run dev`. `npm test` runs the unit tests.
- On Windows, if Vitest fails with "Cannot read properties of undefined (reading 'config')", the shell is using a lowercase drive letter (`c:`), which loads Vitest twice. Run it from a path that starts with `C:`.

## Suggestions (not built)

- Moving and sizing motifs by dragging them on the rug.
- Separate artwork for the upright sides and each corner of a border.
- Saving a design to a file, to move it between computers.
- A cleanup pass that reassigns very small clusters or isolated knots to a neighboring color, to remove blended edges in uploads.
- An option to rotate an upload by 90° for landscape images on portrait rugs.
- Square constraint (Shift) for the rectangle and ellipse tools.
