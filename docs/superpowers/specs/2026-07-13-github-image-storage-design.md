# GitHub Generated Image Storage Design

## Status

This design supersedes `2026-07-13-packy-direct-image-url-design.md`. The live
Packy endpoint rejected `response_format=url`, so generated base64 images need a
separate persistent HTTPS delivery path.

## Goal

Store GPT-Image-2 base64 results in the public
`156631890/dsz_genpic` repository and return stable HTTPS URLs without using
ImgBB.

## Architecture

- Use the GitHub Contents API with a server-only `GITHUB_IMAGE_TOKEN`.
- Write images to the `generated-images` branch under
  `generated-images/YYYY/MM/<uuid>.png`.
- Create the branch once from the deployed default branch before production
  verification.
- Return
  `https://raw.githubusercontent.com/156631890/dsz_genpic/generated-images/<path>`.
- Add `git.deploymentEnabled.generated-images=false` to `vercel.json` so image
  commits do not create Vercel deployments.

## Upload Behaviour

The storage adapter accepts validated generated image files and uploads them one
at a time. Each filename is unique. A GitHub `409` branch-head conflict is
retried up to three times; authentication, permission, validation, and other
provider errors fail safely without exposing the token or response body.

Packy role generation continues to prefer an HTTPS URL returned by Packy. When
Packy returns `b64_json`, the bytes go to GitHub storage. ImgBB is no longer the
generated-role delivery path.

## Configuration

- `GITHUB_IMAGE_TOKEN`: sensitive GitHub token with repository contents write
  access.
- `GITHUB_IMAGE_REPOSITORY=156631890/dsz_genpic`
- `GITHUB_IMAGE_BRANCH=generated-images`

The token is stored only in Vercel Production environment variables. No token,
base64 payload, or provider response is logged or committed.

## Verification

- Unit tests cover request shape, raw URL encoding, safe errors, and 409 retry.
- The existing Packy role test proves `b64_json` is delivered through GitHub and
  returns the same fixed role.
- Health reports GitHub image storage as configured.
- Full tests, typecheck, lint, production build, and tracked-secret scan pass.
- A live production role request returns an HTTPS raw GitHub URL.

