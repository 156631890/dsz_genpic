# Manual Package Weight and Category Matching Design

## Goal

Require the operator to provide package weight together with package length,
width, and height before generation. Resolve the final Dropshipzone category
from the operator's category hint and the supplied `rules/Category_Mapping.md`
file, with the hint taking priority over image and selling-point inference.

## Root Cause

The category mapping file currently yields 275 ordinary two-column mapping
rows, but the selection path is not a reliable search implementation:

- candidate ranking extracts only `[a-z0-9]` tokens, so Chinese hints produce
  no search terms;
- matching uses exact substrings, so `Jewelry` does not match `Jewellery`, and
  product words such as `necklace` do not match a category path containing
  only `Jewellery`;
- generated categories are accepted only when both the ID and model-written
  path exactly equal the mapping row, so a correct ID can be rejected because
  of spelling or separator differences; and
- local fallback category resolution uses a small hard-coded list instead of
  the complete supplied mapping.

Package weight is currently visible only in Details, may be estimated by AI,
and has a local `0.1 kg` fallback. That conflicts with the new requirement
that all four package measurements are entered before generation.

## Approved Behaviour

### Package measurements

- Package weight, length, width, and height are required positive finite
  numbers.
- The Source calibration panel presents all four inputs before the generate
  button, in this order: weight, length, width, height.
- Weight uses kilograms. Length, width, and height use centimetres.
- Source and Details controls share the existing `fields.weight`, `length`,
  `width`, and `height` state.
- All four Details fields are labelled `User-provided`.
- Missing or invalid measurements block both product-data and image generation.
- The product-data API independently rejects missing, zero, negative, and
  non-finite measurements.
- AI output and local fallback paths cannot estimate, default, or overwrite
  any of the four measurements.
- CBM, Vendor Price, RRP, and shipping use the accepted operator values.

### Category matching

- A valid explicit `categoryId` remains the most specific manual selection.
- Otherwise, a non-empty category hint is authoritative over image analysis
  and selling points.
- The final category ID and path always come from
  `rules/Category_Mapping.md`.
- Image and selling-point inference may break a tie between equally suitable
  hint matches. They become the primary evidence only when the hint is empty.
- The system automatically chooses one category; no manual candidate-selection
  step is added.
- A valid model-selected ID is canonicalised to the exact path stored in the
  mapping. A model-written path is never trusted as the source of truth.
- If no closer valid category can be determined, the system uses the mapping's
  documented `General Goods` category with ID `1` and adds a review note.

## User Interface

Rename the Source measurement fieldset to **Package measurements (required)**.
Render a required `Package Weight` input before the existing three dimension
inputs. Use the same numeric input behaviour and shared state as the Details
fields.

The pre-generation error is:

`Enter package weight, length, width, and height before generation.`

The existing category hint remains editable in Source calibration. The chosen
canonical ID and path continue to appear in the existing Details category
fields, so no additional category-results component is required.

## Package Data Flow

1. The operator enters weight, length, width, and height.
2. The client checks that all four values are finite and greater than zero.
3. `ProductInput` sends them as `packageWeightKg`, `lengthCm`, `widthCm`, and
   `heightCm`.
4. The API validates the same contract before invoking any product service.
5. Research and field-generation prompts treat all four values as fixed
   operator facts.
6. Server validation and merge code source all four final values from
   `ProductInput`, ignoring corresponding model values.
7. Deterministic calculations use those final values.

The API error is:

`Package weight, length, width, and height are required.`

Remove the conventional-weight issue and the local `0.1 kg` fallback because
weight is no longer AI-assisted.

## Category Matching Architecture

Create one shared category-matching service used by product research, legacy
AI field assembly, and local fallback assembly. It owns mapping parsing,
normalisation, lexical ranking, and canonical lookup so those paths cannot
drift.

### Mapping parser

The parser produces canonical `{ id, name }` entries from ordinary rows such
as:

`| Fashion / Women's Fashion / Women's Jewellery | 950 |`

It also recognises the supplied file's special General Goods row:

`| General Goods | default / unclassified | ID: 1 |`

Headers, separators, prose, and malformed or duplicate rows are ignored. An
empty or unusable mapping is an error, not permission to use hidden hard-coded
categories.

### Local normalisation and ranking

Normalisation is Unicode-aware and performs these bounded transformations:

- lowercase text;
- replace `&` with `and`;
- remove possessive punctuation and other separators;
- collapse whitespace;
- normalise known British/American variants such as
  `jewelry`/`jewellery`; and
- compare common singular/plural token variants.

Ranking follows deterministic precedence:

1. exact normalised leaf-category match;
2. exact normalised full-path match;
3. full hint contained in the leaf category;
4. complete meaningful-token coverage in the leaf category;
5. weighted token overlap across the full path.

Leaf matches score above ancestor-only matches. More specific, deeper paths
win otherwise equal scores. Stable file order is the final tie-breaker.

An unambiguous high-confidence local result is accepted without asking AI to
rewrite the category.

### Semantic selection

When lexical ranking cannot express the hint's meaning, such as `necklace` or
`项链`, the existing research request performs semantic selection. It receives
canonical mapping entries and must choose an ID from that set. The prompt
states that the category hint is authoritative; images and selling points are
only tie-breakers unless the hint is empty.

The response may retain the existing category object shape for compatibility,
but validation uses only a mapped ID. It replaces the response name with the
canonical name from the file.

### Fallback order

The final resolver applies this order:

1. valid explicit manual category ID;
2. unambiguous high-confidence local hint match;
3. valid AI-selected ID, canonicalised through the mapping;
4. highest-scoring local match;
5. mapped `General Goods / 1`.

An invalid AI ID cannot produce category `0`. A valid ID with a differently
spelled path cannot produce the old path-mismatch review error.

## Error Handling

- If package measurements are invalid, generation does not start.
- If the mapping file cannot be loaded or yields no usable entries, the
  product-field task fails with `Category mapping is unavailable.`
- If General Goods is used because there is no closer result, add:
  `Category defaulted to General Goods because no closer mapping match was found.`
- Do not emit
  `Category needs review because no valid ID and path match was found.` for a
  valid canonical ID.
- Existing provider, image, upload, and authentication errors remain unchanged.

## Testing

### Client

- Package Weight appears before the three dimensions in Source calibration.
- Missing, zero, negative, or non-finite weight blocks all generation requests.
- A valid weight is sent exactly as `packageWeightKg`.
- AI responses cannot overwrite operator weight.
- Editing Source or Details weight updates the same state and invalidates stale
  product data.

### API and package services

- The API rejects every invalid required measurement before calling product
  generation.
- Research prompts no longer request conventional package-weight estimates.
- Research validation and all DSZ assembly paths keep operator package values.
- No hard-coded weight or dimension fallback remains.

### Category matching

- Parse all ordinary mapping rows and General Goods ID `1`.
- `Women's Jewelry` resolves to canonical Women's Jewellery ID `950`.
- `necklace` and `项链` can use semantic selection to resolve to a mapped ID.
- A category hint wins when model/image inference conflicts with it.
- A valid ID with an incorrect path is canonicalised to the mapping path.
- An invalid AI ID falls back to the best local match.
- No match falls back to mapped General Goods ID `1` with the review note.
- Missing or unusable mapping data fails clearly.
- Local fallback uses the complete mapping instead of the hard-coded category
  subset.

### Full verification

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Static audits confirm removal of the `0.1 kg` fallback, conventional weight
  prompt/issue, and strict model-path equality as a category acceptance rule.

## Out of Scope

- Editing or expanding the supplied mapping file's category content.
- Adding embeddings, a database, or an external search service.
- Adding a manual top-three category candidate picker.
- Supporting multiple categories for one product.
- Changing package units, pricing formulas, shipping formulas, or image roles.

## Acceptance Criteria

1. Users cannot start generation until package weight, length, width, and
   height are all positive finite values.
2. Direct API callers receive HTTP 400 for any missing or invalid required
   package measurement.
3. Final package values exactly equal operator input and are never estimated.
4. A category hint is matched against the supplied mapping and takes priority
   over image and selling-point inference.
5. Final category ID and path are always a canonical pair from the mapping.
6. Valid IDs are not rejected because of model-written path differences.
7. Unmatched inputs automatically use General Goods ID `1` with a review note.
8. Automated tests, type checking, linting, and production build pass.
