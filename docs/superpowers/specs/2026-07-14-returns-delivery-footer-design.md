# Returns and Delivery Footer Replacement Design

## Goal

Replace the canonical returns and delivery footer in the DSZ system prompt with the exact user-provided HTML and keep all product-copy paths compatible with that footer.

## Canonical User-Provided HTML

The following block must remain unchanged in `rules/DSZ系统prompt 4月20版本.txt`, including the `<h2>` elements, blank line, `</p >` closing tags, wording, punctuation, and the en dash in `5–12`:

```html
<h2>Returns, Refunds and Replacements</h2>
<p>Products received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with local consumer laws. We are committed to ensuring all products meet the standards of quality and reliability expected by our customers.</p >
<p>Please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p >

<h2>Delivery Timeframe</h2>
<p>Delivery is approximately 5–12 business days (excluding weekends and public holidays).</p >
```

No wording, tag-spacing, punctuation, or heading structure in this block may be normalized in the system prompt.

## Affected Components

### System prompt

Replace the old single-line ACL and regional delivery footer in `rules/DSZ系统prompt 4月20版本.txt` with the exact block above. Add `<h2>` to the prompt's declared allowed tag list so the prompt does not contradict its own canonical footer.

### Canonical footer parser and copy validator

Update `server/services/productCopy.ts` so it can extract and validate the new footer without rewriting the returned canonical text:

- permit `<h2>` and `</h2>`;
- permit the exact closing token `</p >` used by the supplied footer;
- treat `</p >` as `</p>` only for stack-based structural validation;
- require the new returns heading, delivery heading, and `local consumer laws` phrase instead of the removed `Australian Consumer Law (ACL)` phrase;
- allow the en dash character required by `5–12` while retaining the existing rejection of other unapproved non-ASCII characters;
- continue requiring generated descriptions to end with the exact canonical footer tokens and text.

The extracted footer may still collapse line breaks to spaces for the existing single-line product-description contract. It must not otherwise rewrite the supplied tags or wording.

### Server fallback footer

Replace the old `FOOTER` value in `server/services/dszRules.ts` with the same new content. Update the built-in fallback prompt's allowed-tag description and remove the outdated ACL label. This ensures fallback and repair paths cannot restore the previous policy when AI generation is unavailable or invalid.

## Data Flow

1. The product-copy service loads the user-owned DSZ system prompt verbatim.
2. The canonical footer extractor isolates the exact footer region and collapses line breaks only for single-line validation.
3. AI-generated copy must end with that canonical footer.
4. Full-field generation and repair use the same product prompt.
5. If those paths fall back locally, the server appends the matching new fallback footer.

## Error Handling and Safety

- The parser must still reject unknown tags, broken nesting, missing returns or delivery headings, and rewritten footer text.
- Only the exact `</p >` compatibility token is added; arbitrary malformed tag spacing remains unsupported.
- Only U+2013 EN DASH is added to the approved description character set because it is required by the supplied delivery range.
- Existing single-line description, URL, Markdown, entity, and unsupported-character checks remain in force.
- No legal wording is inferred or rewritten by the implementation.

## Tests

Implementation will follow test-driven development:

1. Assert the loaded system prompt contains the exact multiline user block.
2. Assert canonical extraction accepts `<h2>`, exact `</p >`, `local consumer laws`, and `5–12` while preserving tokens and wording.
3. Assert valid product copy ending with the new footer passes validation.
4. Assert the old ACL/footer text is no longer canonical.
5. Assert unsupported heading tags, arbitrary malformed spacing, broken nesting, and unrelated non-ASCII characters remain rejected.
6. Assert fallback product descriptions contain the new footer and none of the old regional delivery wording.
7. Run focused tests through an observed red-green cycle, followed by the full test suite, type checking, lint, and production build.

## Out of Scope

- Editing the supplied policy wording or correcting its HTML style.
- Updating unrelated content in `rules/Product_Upload_AU.md`.
- Legal review of the supplied policy.
- Frontend or product-field changes.
- Changes to shipping price calculations or operational delivery estimates outside the product description footer.
