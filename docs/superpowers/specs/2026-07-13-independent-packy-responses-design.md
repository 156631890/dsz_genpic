# Independent Packy Text and Image Design

## Goal

Make product-copy generation independent from both source-image hosting and image generation. Text generation uses Packy's Responses-compatible API with the existing DSZ system prompt. Image generation continues to use GPT-Image-2 through its own credential path.

## Decisions

- The browser sends product facts directly to `/api/generate-product-copy`; it does not upload source images first.
- The server sends the exact existing DSZ system prompt as `instructions` and the verified product facts as `input` to `POST /v1/responses`.
- Copy generation reads `PACKY_TEXT_API_KEY`, falling back to `PACKY_API_KEY` for backward compatibility.
- Image-role generation reads `PACKY_IMAGE_API_KEY`, falling back to `PACKY_API_KEY` for backward compatibility.
- Health reporting evaluates text and image credentials independently.
- Responses output is accepted from either the top-level `output_text` convenience field or nested `output[].content[].text` items whose type is `output_text`.
- Existing title, description, HTML-footer, and character validation remains authoritative.
- ImgBB remains available for image-delivery fallback, but it cannot block copy generation.

## Request Flow

1. One click starts copy generation and the five image-role jobs in parallel.
2. Copy generation posts product facts with an empty `imageUrls` list to the server.
3. The server calls Packy `/v1/responses` with the text credential and model.
4. Each image role calls Packy's GPT-Image-2 path with the image credential.
5. Copy and image failures remain independently retryable.

## Compatibility and Limits

`PACKY_API_KEY` remains a fallback so existing deployments do not break during credential migration. Packy's dashboard must route the text credential to the `codex` group and expose `gpt-5.6-sol`; application code cannot override provider-side token routing.

## Verification

- Unit tests prove Responses request shape, output parsing, and text-key precedence.
- Unit tests prove image-key precedence and independent health flags.
- UI tests prove copy generation never calls `/api/upload-images` while image roles still run.
- Full test, typecheck, lint, and production build must pass before deployment.
