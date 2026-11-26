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
- Border inset and thickness do not change with the rug, unless the design says borders follow the rug (see below).
- Motifs grow in proportion to the room they are in, within their limits. A motif that follows another takes that one's size instead. Offsets are at 100% and grow with the motif.
- In the knot map, pieces start and end on whole knots.

### Reading a rug picture

Replaces "Split a rug picture", which only cut the picture into rectangles. "Read a rug picture" finds the parts of the rug, numbered as on a rug component map, and makes each one a layer: its background color, its shapes cut free of that background, and resize rules.

| # | Part | How it is found | Layer and rules |
|---|---|---|---|
| 1 | End finish | Always there | Not a layer; the rug preview draws the fringe |
| 2 | Outer edge band | Outermost band that is one plain color | Border, color only |
| 3, 4 | Outer guards | Thin patterned bands outside the main border | Border; one unit slid round, no mirroring, mitred corners |
| 5 | Main border | Widest patterned band, at least 1.8 × the others | Border laid out from the middle (see below), own artwork for the sides |
| 6 | Border corners | Corner square of the main border | Corner piece; keeps the border's size, never stretched |
| 7, 8 | Inner guards | Thin patterned bands inside the main border | As outer guards |
| 9 | Field (ground) | What fills the middle of the long sides of the field | Fill: a quarter, mirrored both ways, with its small motifs; the big shapes are cut out of it |
| 10 | Central medallion | Big non-ground shape at the center, holes filled | Motif at the center, keeps its shape |
| 11 | Pendants | Big shapes on the vertical middle line above and below it | Motif hung above and below the medallion |
| 12 | Corner spandrels | A color much denser in the four field corners than elsewhere, and all the field the center cannot reach without crossing it | Motif in the four corners, mirrored |
| 13 | Spandrel pockets | A box-like patch of another color in a spandrel's outer corner | Motif that follows the spandrel |

- **Only the shape.** A rectangle round a motif carries ground color and bits of its neighbours. The ground is removed only where it reaches the rectangle's edges, so the same color inside the shape stays; then only the part in the middle is kept (or the part the analysis found there). The field layer is the exception: its ground is removed everywhere, because the layer's own color is that ground.
- **Ground colors** are the largest group of near-identical colors in a part, clustered without blurring so motifs do not muddy it. Lightness counts half in every color comparison: abrash, the natural variation of hand-dyed wool, mostly changes lightness.
- **Band edges** are found on each side separately, then lined up with the top side by a scale and a shift, because a photo is rarely square-on (here the bottom border looked 1.25 × the top). Each edge is then settled on its own side. Edges where the ground is the same either side are dropped (a row of motifs, not a new band). A thin innermost band that does not repeat is taken for the edge of the field. A neutral margin at the picture's edge (floor, backdrop, shadow) is left out, side by side.
- **Plain or patterned.** A band is plain when 88% of its middle is within 0.05 of its main color: hand-dyed streaks stay inside that, motifs do not.
- **Repeats.** Hand-knotted motifs are never drawn the same twice, so a band matches itself one unit on by only 0.25 to 0.5 (a printed design would reach 0.9). The repeat search uses color as well as lightness and accepts a clear peak from 0.22.
- **Main borders mirror; they do not repeat.** The top run here is M1 M3 M2 M4 | M9 | M4 M2 M3 M1, all different. It is cut into slots: a middle piece and the same number of slots either side. The slot count is the one, of those near "slots about as long as the band is thick", whose slot edges fall most on the border's ground, between motifs. Growing adds one slot each side and continues the order outwards (M4 M2 M3 M1 M4 …), so anchors and crosses keep alternating.
- **Quartered field.** Taken as quartered when it is like its own mirror image both ways by 0.3 or more, measured after blurring (a photo at a slight angle is never an exact mirror).
- The picture is read at up to 1800 px on its long side; thin guards are only a few pixels wide at 900 px. Reading the example rug takes about 2.5 s; a progress line shows meanwhile.
- Any part can be left out before the layers are made. Moving a band edge reads the picture again with that edge.
- Anything found can be replaced afterwards with "Picture", which now offers "Only the shape, off its background" (the default), "Remove one color everywhere" (the old behaviour) or "The whole rectangle".

### The assumptions, checked against the example rug

- **Medallion only scales and stays at the center: confirmed.** It grows with the field's tighter side, keeping its shape, so a longer rug gets more ground above and below, not a taller medallion.
- **Pendants scale and keep padding from the border or the medallion: half right.** In this rug the pendants hang from the medallion's tips by a stem; they are not spaced from the border. So they take the medallion's size and keep their gap to it (scaled), and only the border sets a limit: at least half the room they had. Without that room they shrink, and below their smallest size they are left out rather than squeezed.
- **Spandrels** were not in the list but needed a rule: anchored in the field's corners and scaled exactly like the medallion. Then the octagon keeps its angles at every size and never closes onto the medallion. Pockets take the spandrel's size and stay in its corner.
- **Border corners do not stretch: confirmed**, and the main border re-pitches its slots between them.
- **Guards slide without mirroring: confirmed.** Their unit is about 24 px on the 1393 px example, as the repeat map says.
- **Not assumed, but needed: borders shrink on small rugs.** With fixed borders a 3 × 10 ft runner from a 9 × 12 ft design was almost all border. Read designs therefore let borders follow the rug's shorter side, from 55% to 120%, all by the same amount so they stay flush, and their motifs with them. This can be turned off or changed in the builder.
- **Small rugs** carry proportionally smaller medallions and spandrels, so read motifs may shrink to 30%. When motifs that are not tied to each other still run into each other at their limits (much more than at the original size), both are marked "crowded" and a warning shows.

### Rug size while building

- Dragging the rug's handles, or typing a width or length, in the segment builder now sets the rug's size. Step 1 shows it, with the knot grid worked out again. The design was "tested" before and the size stayed the same.
- The knot limits (16,384 per side, 25 million in all) and the borders' smallest size apply while dragging.
- Upload and drawing work in progress is fitted to the new proportions, as after resizing.

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

- `dev/analyse.dev.test.ts` runs the picture reading on a real photo and writes what it found, for tuning. It is skipped unless `RUG_FIXTURE` names a raw RGBA file (4-byte width, 4-byte height, then pixels) and `RUG_OUT` a folder.

- `npm install`, then `npm run dev`. `npm test` runs the unit tests.
- On Windows, if Vitest fails with "Cannot read properties of undefined (reading 'config')", the shell is using a lowercase drive letter (`c:`), which loads Vitest twice. Run it from a path that starts with `C:`.

## Suggestions (not built)

- Moving and sizing motifs by dragging them on the rug.
- Separate artwork for the upright sides and each corner of a border.
- Saving a design to a file, to move it between computers.
- A cleanup pass that reassigns very small clusters or isolated knots to a neighboring color, to remove blended edges in uploads.
- An option to rotate an upload by 90° for landscape images on portrait rugs.
- Square constraint (Shift) for the rectangle and ellipse tools.
