# Packy Direct Image URL Design

## Goal

Remove ImgBB from the normal GPT-Image-2 delivery path. Packy must return a
provider-hosted HTTPS image URL that the existing five-role workflow can use
directly.

## Decision

Every Packy `/v1/images/edits` multipart request will include:

- `response_format=url`
- `output_format=png`

This follows Packy's documented GPT-Image-2 image-edit protocol. The existing
strict HTTPS validation remains the trust boundary. A valid provider URL is
returned directly to the browser and DSZ payload without another upload.

## Scope

- Change only the shared Packy image-edit request builder.
- Keep the text API, prompts, five image roles, retry policy, concurrency, UI,
  and DSZ field workflow unchanged.
- Keep existing base64 parsing code only as backward compatibility if a
  provider unexpectedly ignores `response_format`; it is not the production
  delivery path.
- Do not add GitHub storage, repository write credentials, or image commits.

## Verification

- A request-level test proves both multipart fields are present.
- Existing tests prove HTTPS Packy URLs return without an ImgBB request.
- Existing malformed/non-HTTPS URL tests remain green.
- A live Packy image-edit probe must return one HTTPS URL.
- Production health, build, and one image-role request must pass after deploy.

