# Full Product Field Generation Design

## Goal

Extend the current one-button DSZ Product Studio workflow so the independent GPT-5.6 SOL text workflow fills the complete product record from the user's rule documents, uploaded source images, seller facts, and evidence-backed web research. GPT-Image-2 remains a separate image-only workflow with its own credential, state, failures, and retries.

## Approved Scope

- Keep one primary generation button.
- Keep GPT-5.6 SOL and GPT-Image-2 independent and start them in parallel from the browser.
- Use the existing `PACKY_TEXT_API_KEY` only for GPT-5.6 SOL product research and copy generation.
- Use the existing `PACKY_IMAGE_API_KEY` only for the five GPT-Image-2 image roles.
- Send the original product images to GPT-5.6 SOL as `input_image` content.
- Enable the Packy Responses `web_search` tool for product research.
- Fill all DSZ Details, Price, Shipping, and Images fields from model research, fixed rules, deterministic formulas, or the five-role image results.
- Preserve manual review and manual editing before submission.
- Keep the uploaded files in `rules/` as the authoritative business-rule sources.

## Out of Scope

- Guessing package weight or dimensions without evidence from the same product and variant.
- A second web-search provider or another API credential.
- A multi-user database, shared identity service, batch generation, job queue, or generation history.
- Automatic live publication without operator review.
- Replacing source product images with unrelated search results.

## Architecture

The React client remains the workflow coordinator. One click starts two independent promises:

1. A GPT-5.6 SOL product-data workflow that performs evidence-backed research and then generates copy.
2. The existing GPT-Image-2 workflow that generates the five fixed image roles with at most two image requests in flight.

The GPT-5.6 SOL workflow has two sequential stages that use the same Packy text endpoint, model, and credential:

1. **Research stage:** GPT-5.6 SOL receives the uploaded source images, seller-provided facts, field rules, category mapping, and a `web_search` tool. It identifies the product, selects a DSZ category, determines visible colour, and searches for the exact product and variant when package weight or dimensions were not supplied.
2. **Copy stage:** GPT-5.6 SOL receives only verified product facts from the user and accepted research. It uses the exact `rules/DSZ系统prompt 4月20版本.txt` content as its system instructions and returns the required two-line title and single-line HTML description.

The server validates and merges both stages. Fixed values and formulas are calculated by application code, not trusted from model output.

## Rule Precedence

The rule documents contain older examples that conflict with the later verified Supplier API section. The following precedence is explicit:

1. The latest verified Supplier API rules in `Dropshipzone_Field_Rules.md`.
2. The user's subsequently approved shipping rule.
3. The exact product title and description rules in `DSZ系统prompt 4月20版本.txt`.
4. The remaining field, category, SOP, and AU upload guidance.

Consequently:

- Supplier EAN is a 10-digit string, not a 13-digit EAN-13 value.
- Status is numeric `1` for active and `0` for draft.
- Stock defaults to `1000`.
- Australian shipping zones are free.
- New Zealand shipping is AUD 20 below 3 kg billable weight and AUD 40 at or above 3 kg billable weight.
- Product copy must end with the exact ACL and Delivery Timeframe footer from the product system prompt, not an older footer example in the SOP documents.

## Field Ownership

### GPT-5.6 SOL research fields

- `category`, `categories`, and `categoryName`
- `colour`
- `weight`, `length`, `width`, and `height` only when user facts exist or same-product evidence passes validation
- `risk_flags`
- evidence and review notes used by the operator but omitted from the Supplier API payload

### GPT-5.6 SOL copy fields

- `product_name`
- `description`

### Deterministic application fields

- `sku`: browser-persistent single-operator counter in `Elosung10000` through `Elosung19999` format
- `ean_code`: browser-persistent set of generated 10-digit values with local duplicate prevention
- `status`: `1`
- `stock`: `1000`
- `brand_name`: `Elosung`
- `enabled`: `true`
- `cbm`: `length * width * height / 1,000,000`, rounded to six decimals
- `vendor_price`: `(MAX(weight, length * width * height / 8000) * 40 + 45 + purchasePriceCny) / 3.05`
- `rrp`: `vendor_price * 2`
- `zone_rates`: server-calculated from the approved Australian and New Zealand shipping rules

The browser-local SKU and EAN store matches the current single-operator scope and survives deployments on the same production origin. It is not a cross-device uniqueness guarantee. A shared database is required before multi-operator use.

### GPT-Image-2 fields

- `images` in the fixed order: main, side, detail, lifestyle 1, lifestyle 2

## Research Request and Response Contract

The server modernizes the existing full-field route instead of adding another overlapping API. `POST /api/generate-product-fields` accepts multipart form data containing:

- one to four supported source product images;
- seller selling points;
- optional category guidance;
- optional purchase price;
- optional verified package weight and dimensions.

The Packy Responses request uses:

- model `PACKY_TEXT_MODEL`, default `gpt-5.6-sol`;
- credential `PACKY_TEXT_API_KEY`, falling back only to the shared legacy text credential;
- `stream: true`;
- source images as `input_image` content;
- product context as `input_text` content;
- `tools: [{ "type": "web_search" }]`;
- no image-generation tool.

The research result is strict JSON with this logical shape:

```json
{
  "identity": {
    "productType": "string",
    "variant": "string",
    "matchSummary": "string"
  },
  "category": {
    "id": 0,
    "name": "string"
  },
  "colour": "string",
  "package": {
    "weightKg": 0,
    "lengthCm": 0,
    "widthCm": 0,
    "heightCm": 0,
    "confidence": "high|medium|low"
  },
  "sources": [
    {
      "url": "https://example.com/product",
      "title": "string",
      "matchedVariant": "string",
      "evidence": "string"
    }
  ],
  "riskFlags": [],
  "reviewNotes": []
}
```

The public response contains only validated fields, safe evidence metadata, and safe issue messages. It never contains credentials, authorization headers, raw provider payloads, or hidden reasoning.

## Same-Product Evidence Gate

Package measurements are accepted only when all applicable conditions pass:

- At least one HTTPS source URL appears in the actual Packy web-search annotations and the structured research result.
- The source identifies the same product type and distinctive visible characteristics.
- The source variant, pack quantity, size, capacity, or model agrees with the uploaded product when those attributes are available.
- The source explicitly supports the package measurement; a generic category estimate is not evidence.
- Returned measurements are finite positive numbers.

Source priority is:

1. manufacturer or supplier product page;
2. exact 1688 supplier listing;
3. exact marketplace product listing;
4. other authoritative product documentation.

Similar products, category averages, search-result guesses, and model estimates are rejected. If sources conflict or only a similar product can be found, the server retains any verified manual measurement, otherwise leaves the missing value unresolved and adds a review issue. It does not silently substitute a number.

## Category Validation

GPT-5.6 SOL selects the most specific matching category from the complete `Category_Mapping.md` content. The server parses the mapping and accepts the selection only when the returned ID and category path form a valid pair. An explicit operator category hint takes priority over model selection. Invalid or unknown model categories become review issues and are not submitted as fabricated IDs.

## Copy Contract

The second GPT-5.6 SOL call keeps the existing validated copy contract:

- use the exact UTF-8 product system prompt;
- include verified user facts and accepted research facts only;
- enable web search because the product prompt requires Australian-market research;
- use streaming Responses output;
- parse exactly two non-empty lines;
- require a 110 to 200 character ASCII ecommerce title;
- require a single-line HTML description with allowed tags only;
- reject URLs, Markdown, unsupported characters, and malformed HTML;
- require the exact canonical ACL and Delivery Timeframe footer;
- retry empty or invalid model content without retrying deterministic HTTP failures.

## Price and Shipping Rules

Package measurements use accepted user facts first and accepted same-product research second. Model-supplied price calculations are ignored.

Vendor Price and RRP are calculated only when the purchase price and all required package measurements are valid. If purchase price is absent, the price fields remain unresolved and the UI asks the operator for it instead of searching or guessing a supplier purchase price.

Shipping uses billable weight:

`MAX(actualWeightKg, lengthCm * widthCm * heightCm / 5000)`

- All Australian zones: AUD 0.
- New Zealand below 3 kg: AUD 20.
- New Zealand at or above 3 kg: AUD 40.

## Client Data Flow

1. The operator selects source images and enters selling points plus any known facts.
2. One click invalidates stale work and starts the GPT-5.6 SOL and GPT-Image-2 workflows in parallel.
3. The full-field request sends source images and facts to `/api/generate-product-fields`.
4. The server researches and validates the product, generates copy, calculates deterministic fields, and returns fields plus evidence issues.
5. The client applies each returned field only if the operator has not edited that field since the request began.
6. The five image calls finish independently and populate fixed image slots.
7. The generated image URLs become the final `images` field in fixed role order.
8. The operator reviews evidence, edits fields if required, and submits only after existing upload validation passes.

## User Interface

- Rename the text status card to `GPT-5.6 SOL Product data & copy`.
- Mark Category, Product Name, Colour, package measurements, and Description as GPT-assisted fields.
- Keep CBM, price, RRP, fixed values, and shipping visibly labelled as automatic rules rather than AI guesses.
- Add a compact `Research evidence` area showing matched product, confidence, source links, and review issues.
- Keep the existing per-role GPT-Image-2 status and retries.
- A full-field retry calls only the GPT-5.6 SOL workflow and does not clear completed image roles.
- Missing or rejected evidence produces `Needs attention`, not a false `Complete` state.
- Manual field edits made during an in-flight request are never overwritten by late results.

## Error and Partial-Result Behaviour

- Authentication, provider, and transport failures return safe messages and never expose raw Packy content or credentials.
- GPT-5.6 SOL failures do not cancel or remove GPT-Image-2 successes.
- GPT-Image-2 failures do not cancel or remove generated product data.
- Invalid research JSON, unsupported category IDs, unannotated source URLs, or unverifiable measurements become safe text-workflow errors or review issues according to whether valid remaining fields can be returned.
- Missing package evidence does not trigger fallback estimates.
- Missing purchase price prevents price completion but does not discard valid research or copy.
- Existing manual field values take priority over absent or rejected generated values.

## Security and Deployment

- Text and image credentials remain server-only and independent.
- No credential is committed, sent to the browser, logged, or embedded in an error.
- Search evidence is treated as untrusted external data and never inserted into HTML without validation.
- Provider source URLs are shown only as evidence and are excluded from the DSZ description and upload payload.
- The implementation keeps the current Vercel deployment model and does not add a database.

## Testing Strategy

### Service tests

- Build a GPT-5.6 SOL research request containing `input_image`, `input_text`, `web_search`, and `stream: true`.
- Parse streamed text deltas and web-search annotations.
- Accept exact-product annotated measurement evidence.
- Reject similar-product, unannotated, conflicting, zero, negative, and non-finite measurements.
- Validate category ID and path against the loaded mapping.
- Preserve verified manual measurements over research results.
- Calculate CBM, price, RRP, and shipping from accepted measurements.
- Keep copy generation bound to the exact product system prompt.

### API tests

- Accept valid multipart images and facts for full-field generation.
- Reject missing images, unsupported image types, oversized input, and invalid facts safely.
- Return complete validated fields and evidence metadata.
- Keep text and image credentials independent.
- Do not expose credentials, raw provider errors, hidden reasoning, or unsafe source content.

### Client tests

- One click starts complete product-data generation and five-role image generation.
- Successful full-field generation populates Details, Price, and Shipping fields.
- Field application preserves manual edits made while generation is running.
- Evidence links and review issues render safely.
- Missing evidence leaves package fields unresolved and shows `Needs attention`.
- Text retry does not call or clear image generation.
- Image failure does not clear completed product fields.
- Generated images populate the final payload in fixed role order.

### Verification

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Live Packy capability probe for image input and web search without exposing output secrets
- Production request verifying complete product-field output and evidence handling
- Vercel deployment status and production alias verification

## Acceptance Criteria

1. One click starts independent GPT-5.6 SOL complete-field and GPT-Image-2 five-role workflows.
2. GPT-5.6 SOL receives source images and performs Packy web search using the text credential only.
3. Category and colour are generated and validated from product context.
4. Missing weight and dimensions are filled only from accepted same-product web evidence; they are never estimated.
5. Title and description pass the exact existing system-prompt validation.
6. SKU, 10-digit EAN, fixed values, CBM, prices, RRP, and shipping follow deterministic rules.
7. Details, Price, Shipping, and Images fields are populated from their approved owners.
8. Evidence sources and unresolved issues are visible before submission.
9. Manual edits and successful results from the independent workflow are preserved across failures and retries.
10. Credentials remain untracked and server-only, automated verification passes, and the production endpoint is verified before completion is claimed.
