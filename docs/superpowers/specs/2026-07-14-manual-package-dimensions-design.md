# Manual Package Dimensions Design

## Goal

Require the operator to provide the package length, width, and height before
starting AI generation. These three measurements are user-owned facts: the AI
must not estimate, default, or overwrite them.

Package weight is outside this change and keeps its existing manual or AI
assisted behaviour.

## Approved Behaviour

- Package length, width, and height are required positive numbers in
  centimetres.
- The application does not start either the product-data workflow or the
  five-image workflow while any required dimension is missing or invalid.
- The client explains which measurements are required before generation.
- The product-data API rejects requests that omit a dimension or provide zero,
  a negative value, or a non-finite value.
- User dimensions are the only source for the final `length`, `width`, and
  `height` product fields.
- AI output cannot replace the supplied values.
- No fallback package dimensions are generated.

## User Interface

Add a compact **Package dimensions (required)** group to the Source generation
calibration area. It contains numeric inputs for length, width, and height, all
labelled in centimetres.

The Source inputs and the existing Details fields bind to the same
`fields.length`, `fields.width`, and `fields.height` state. This preserves one
source of truth while keeping the measurements visible during final review.
Both locations label the values as user-provided rather than GPT-assisted.

When any dimension is not a positive finite number:

- show a concise inline validation message near the Source inputs;
- mark the invalid controls for accessibility;
- prevent generation; and
- keep a guard inside `startGeneration` so no text or image request can start
  even if the button state is bypassed.

Editing a dimension after generation keeps the existing behaviour of marking
product-data output stale. Completed image roles remain intact. The operator
must regenerate product data before submission because dimensions affect CBM,
price, and shipping.

## Client Data Flow

1. The operator selects source images, enters selling points, and enters all
   three package dimensions.
2. The client validates that each dimension is greater than zero.
3. `productInput` sends the three values as `lengthCm`, `widthCm`, and
   `heightCm`.
4. Product-data generation and image generation start only after validation
   succeeds.
5. Returned product fields retain the operator values.
6. Existing deterministic functions calculate CBM, billable weight, price,
   RRP, and shipping from those values.

## Server Validation and AI Boundary

`POST /api/generate-product-fields` validates the three dimensions in addition
to the existing numeric validation. Missing or non-positive dimensions return
HTTP 400 with a safe, specific error. This prevents callers from bypassing the
browser requirement.

The GPT-5.6 SOL research request includes the operator dimensions as fixed
facts. Its instructions explicitly prohibit estimating or changing them. The
model may continue to estimate package weight when no manual weight is
provided, but any model-supplied length, width, or height is ignored during
validation and merging.

Research issues distinguish a conventional weight estimate from manual
dimensions. They must not describe the three dimensions as AI estimates.

## Fallback Behaviour

Remove the existing `15 x 17 x 3 cm` package-dimension defaults and every other
path that substitutes generated dimensions. Fallback product fields use the
validated operator measurements. A service call that reaches field generation
without valid dimensions fails clearly instead of inventing values.

## Error Handling

- Client error: `Enter package length, width, and height before generation.`
- API error: `Package length, width, and height are required.`
- Existing unsupported-image, size-limit, provider, and authentication errors
  remain unchanged.
- Invalid dimensions never start partial image generation from the primary
  one-button workflow.

## Testing

### Client tests

- Missing, zero, or negative dimensions prevent generation and make no API
  calls.
- Valid dimensions allow the existing parallel workflow.
- The request contains the exact operator measurements.
- AI responses do not overwrite manual dimensions.
- Editing dimensions recomputes deterministic display values and marks product
  data stale.

### API and service tests

- The product-data route rejects missing, zero, negative, and non-finite
  dimensions.
- The research request says dimensions are fixed operator facts and does not
  request dimension estimates.
- Research validation always keeps the input dimensions even when model JSON
  contains different values.
- Conventional estimation, when needed, applies only to package weight.
- Fallback field generation does not contain hard-coded dimension defaults.

### Verification

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Out of Scope

- Requiring the operator to enter package weight.
- Changing dimension units from centimetres.
- Batch product generation, shared persistence, or cross-device identity.
- Changing the five image roles or their prompts.
- Changing Dropshipzone pricing or shipping formulas.

## Acceptance Criteria

1. Users cannot start generation until length, width, and height are positive.
2. Direct API callers receive HTTP 400 when any required dimension is absent or
   invalid.
3. The final product record uses the exact operator dimensions.
4. No AI prompt, merge path, or fallback supplies replacement dimensions.
5. Package weight keeps its current behaviour.
6. CBM, pricing, and shipping continue to use the accepted manual dimensions.
7. Automated tests, type checking, linting, and production build pass.
