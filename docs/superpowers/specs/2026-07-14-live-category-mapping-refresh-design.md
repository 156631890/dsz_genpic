# Live Dropshipzone Category Mapping Refresh Design

**Date:** 2026-07-14

## Goal

Replace the stale local Dropshipzone category mapping with the current category
catalog returned by the production Supplier API `GET /new_categories` endpoint.
The refreshed file must remain compatible with the existing local category
parser and matcher, and the application must stop instead of substituting the
obsolete `General Goods` ID when no valid category can be matched.

## Scope

This change updates `rules/Category_Mapping.md`, removes the obsolete
`General Goods (ID 1)` fallback from category matching and bundled rule text,
and returns one safe, actionable generation error when no live category can be
matched. It does not add runtime category fetching, upload-time category
validation, or a reusable download command.

## Source of Truth

The production Dropshipzone Supplier API `GET /new_categories` response is the
sole source of category IDs, names, hierarchy paths, and active status. The
current response contains 799 active categories. Existing IDs and examples in
the local mapping are not treated as authoritative.

Production credentials are read from the existing Vercel environment and are
never written to the repository or printed in command output.

## Mapping Format

Each API category contains a slash-delimited `path` of category IDs. Every live
path starts with the structural prefix `1/342`, but those two IDs are not
returned as categories and must not be emitted as uploadable mappings. The
refresh builds an ID-to-category lookup, removes that exact structural prefix,
resolves every remaining ID in each path to its category name, and emits one
canonical Markdown row:

```text
| Full / Category / Path | category_id |
```

Full paths are required because the live catalog contains repeated leaf names.
Rows are emitted in deterministic hierarchy order. The document header records
the API source, refresh date, and active category count. Stale numeric examples
and legacy mappings are removed so the parser cannot treat them as valid IDs.

## Unmatched Category Behaviour

ID `1` is part of the unreturned `1/342` structural path prefix; it is not a
category returned by `/new_categories`. The matcher therefore no longer
defaults an unresolved product to `General Goods (ID 1)`.

When manual ID, category hint, model selection, and local keyword ranking all
fail to produce an ID from the refreshed mapping, the matcher throws a typed
category-match error. The full-field generation endpoint maps only that typed
error to HTTP `422` with this operator-safe message:

```text
No valid Dropshipzone category matched. Enter a more specific category hint and generate again.
```

The existing frontend already displays API error messages, so no frontend
change is required. Other internal errors remain masked. Bundled field rules
and the upload SOP are updated to remove stale static category tables and the
invalid ID `1` fallback; they point to `Category_Mapping.md` as the canonical
snapshot instead.

## Validation

The refresh is accepted only when:

1. The API response contains 799 active categories.
2. Every category ID is a unique positive integer.
3. The only path IDs absent from the downloaded category set are the exact
   structural prefix IDs `1` and `342`, and every path begins with `1/342`.
4. Every remaining ID in every API `path` resolves to a downloaded category.
5. Every emitted Markdown row can be parsed by the existing category matcher.
6. The parsed row count equals the downloaded category count.
7. The canonical `Home & Garden / Bedding` row resolves to ID `1143`.
8. IDs `1`, `12004`, and the other stale local-only IDs are absent from the
   refreshed mapping and bundled category guidance.
9. An unmatched category throws the typed category-match error and the API
   returns the safe `422` message, while unrelated internal errors stay hidden.
10. Focused category, workflow, research, and API tests pass.
11. The complete test suite, type check, lint, and production build pass.

## Non-goals and Residual Risk

The application continues to rely on the checked-in snapshot at runtime. If
Dropshipzone changes its catalog again, the file must be refreshed again. A
future runtime validation feature is deliberately excluded from this change.
