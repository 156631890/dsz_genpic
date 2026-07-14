# English-Only Generated Image Text Design

## Goal

Ensure every generated product image follows one text-language policy: if any readable text appears, it must be English. This applies to the five fixed image roles, individual role retries, and the retained legacy image-generation routes.

## Confirmed Behaviour

- Any readable word, label, caption, package line, sign, or graphic text in a generated image must be English.
- Chinese and all other non-English text from source images must not survive into generated output.
- The removal rule includes non-English brand names, trademarks, product labels, and packaging text.
- Non-English source text may be translated only when its English meaning is supported by the supplied product information or source context.
- When an accurate translation is not supported, the model must remove the text instead of guessing.
- The model must not generate invented English claims, misspellings, gibberish, or pseudo-text.
- When compliant text cannot be produced confidently, the image should contain no readable text.

Numbers and ordinary punctuation may accompany English text. Product appearance should otherwise remain accurate and recognizable.

## Chosen Approach

Add one shared English-only text policy at the final Packy image-request composition point in `server/services/packyImages.ts`.

Every current image path ultimately calls `buildPackyEditRequest`. Appending the policy there, after the product type and caller-supplied prompt, gives it final precedence and covers:

- fixed-role main, side, detail, lifestyle 1, and lifestyle 2 generation;
- individual fixed-role retries;
- the legacy single-image edit route;
- the legacy five-image Shopify route.

The role-specific composition rules remain unchanged. No frontend controls or API request fields are added.

## Prompt Policy

The final request must state, in direct English instructions, that:

1. all visible readable text must be English only;
2. all Chinese and other non-English source text, including branding and packaging, must be removed;
3. translation is allowed only when exact meaning is supported, otherwise the text must be omitted;
4. invented wording, unsupported claims, misspellings, gibberish, and pseudo-text are forbidden;
5. no text is preferred whenever correct English text cannot be guaranteed.

The policy must be placed after caller-controlled prompt content so product type, selling points, role descriptions, and legacy prompts cannot override it.

## Validation and Error Handling

This change uses generation-time prompt enforcement only. It does not add OCR, post-generation language detection, automatic regeneration, or new external dependencies. Existing request retry and error behaviour remains unchanged.

Prompt enforcement materially reduces non-English output but cannot mathematically guarantee model compliance. If production evidence later shows repeated violations, OCR-based validation and regeneration should be designed as a separate feature because it changes latency, cost, dependencies, and failure modes.

## Tests

Implementation will follow test-driven development:

1. Add assertions against the actual multipart prompt and verify they fail before production code changes.
2. Cover the shared request builder, fixed-role generation, legacy single-image generation, and legacy five-image generation.
3. Assert that the language policy appears after caller-supplied prompt content.
4. Assert the policy covers source branding and packaging, unsupported translations, invented wording, and pseudo-text.
5. Make the smallest production change that passes the focused tests.
6. Run the full test suite, type checking, lint, and production build.

## Out of Scope

- OCR or image-language classification.
- Additional AI review calls or automatic language-based retries.
- A user-selectable image language.
- Changes to product copy generation.
- UI or layout changes.
