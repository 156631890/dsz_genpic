# Independent Packy Generation Design

## Goal

Optimize the existing DSZ Product Studio so one user action starts two independent Packy workflows: GPT-5.6 SOL generates the English product title and HTML description from the user's system prompt, while GPT-Image-2 generates five fixed-role ecommerce images. Either workflow may succeed, fail, or be retried without changing the other workflow's state or results.

## Approved Scope

- Keep one primary `Start AI Generation` button.
- Use `https://www.packyapi.com` for both provider calls.
- Share one server-side Packy credential, but keep the text and image endpoints, services, request state, results, errors, and retries independent.
- Use `/v1/chat/completions` with model `gpt-5.6-sol` for title and description.
- Use `/v1/images/edits` with model `gpt-image-2` for product images.
- Generate exactly five image roles in this order: feature main image, side angle, detail or packaging image, lifestyle scene 1, lifestyle scene 2.
- Keep the existing manual review and DSZ submission workflow.
- Present the DSZ fields shown in the user's reference screenshots across Details, Price, Shipping, and Images tabs.

## Out of Scope

- User accounts, batch product generation, job queues, generation history, and a database.
- A second web-search provider or search API. The application sends the approved system prompt to GPT-5.6 SOL; that provider model is responsible for following the prompt's Australian-market research instruction.
- AI generation of SKU, EAN, stock, price, weight, dimensions, CBM, brand, enable status, or shipping rates.
- Silent template copy, silent source-image substitution, and automatic live product submission.

## Architecture

The React client remains the workflow coordinator. A single click validates the shared inputs and starts two promises. The client observes them with `Promise.allSettled`, but each promise owns a separate state object with `idle`, `loading`, `success`, or `error` status.

The Express server exposes separate text and image routes. Each route delegates to a focused Packy adapter. Both adapters read the same credential from the server environment but do not call one another and do not share fallback behavior.

## API Surface

- `POST /api/generate-product-copy` accepts verified product context and uploaded HTTPS source image URLs. It returns `{ title, description }` only after the two-line model response passes validation.
- `POST /api/generate-product-image-role` accepts the original source images plus one role identifier: `main`, `side`, `detail`, `lifestyle_1`, or `lifestyle_2`. It returns one generated image URL and its role.
- `POST /api/upload-images` remains the source-image URL preparation endpoint used by the text promise.

The client-level image task owns five role-specific calls to the image route. This preserves one logical image task in the UI while allowing role-level progress, partial success, and retry.

The browser never receives the Packy credential. The credential is stored only in the untracked `.env.local` file. Source code, tests, responses, errors, and logs must never contain or echo it.

## Client Data Flow

1. The user selects one or more source product images and enters selling points. Category guidance is optional.
2. The user clicks `Start AI Generation` once.
3. The client immediately starts the image promise, which schedules five role-specific requests with the original image files.
4. Independently, the text promise prepares HTTPS source image URLs, then requests title and description generation.
5. The image promise reports progress from `0/5` through `5/5` and stores each successful role as its role-specific request resolves.
6. The text promise stores the title and description only after response parsing and validation succeed.
7. `Promise.allSettled` concludes the combined button action. A rejected promise does not clear or roll back the other promise's successful data.
8. The client exposes a retry action only for the failed text task or missing image role. The main generation control remains a single primary button.

## Text Generation Contract

### Prompt source

The exact UTF-8 contents of `rules/DSZ系统prompt 4月20版本.txt` are loaded at generation time and sent as the `system` message. The prompt is not duplicated in TypeScript. This keeps the user-owned file as the single source of truth and allows prompt updates without editing application logic.

The `user` message contains only verified product context: seller-provided facts, selling points, optional category guidance, and the available product images. It must not add writing rules that conflict with the system prompt.

### Provider request

- Base URL: `PACKY_BASE_URL`, defaulting to `https://www.packyapi.com`
- Endpoint: `/v1/chat/completions`
- Model: `PACKY_TEXT_MODEL`, configured as `gpt-5.6-sol`
- Credential: `PACKY_API_KEY`

### Response shape

The approved system prompt requires exactly two output lines:

1. Final English product title
2. Complete single-line English HTML description, including the fixed ACL and delivery footer

The server parses the first non-empty line as the title and the second non-empty line as the HTML description. Any additional non-empty line is a format error.

### Validation

Before returning generated copy to the browser, the server verifies:

- The title contains only English text and basic ASCII punctuation.
- The title length is between 110 and 200 characters.
- The description contains no newline or tab.
- Only `<p>`, `<strong>`, `<ul>`, `<li>`, and `<br />` tags are used.
- The description contains no URL, hyperlink, image, table, heading, `div`, or `span` tag.
- The fixed Australian Consumer Law returns text and delivery timeframe footer are present.
- Forbidden special characters and obvious Markdown fences are absent.

An invalid response is rejected and never overwrites the current title or description. There is no local copy fallback.

## Image Generation Contract

### Provider request

- Base URL: `PACKY_BASE_URL`, defaulting to `https://www.packyapi.com`
- Endpoint: `/v1/images/edits`
- Model: `PACKY_IMAGE_MODEL`, configured as `gpt-image-2`
- Credential: `PACKY_API_KEY`
- Default size: `1024x1024`
- Default quality: `high`

The image service makes one request for each fixed role so progress and retries are role-specific. It preserves product identity, prohibits watermarks and unsupported text, and produces square ecommerce images.

Successful image URLs are retained in their fixed slots. A failed role remains visibly failed and can be retried without regenerating completed roles. The application must not fill a failed slot with the source image and present it as generated output.

## DSZ Fields and Ownership

### Details tab

- Category: rule-assisted or manual
- Product Name: GPT-5.6 SOL title
- SKU: manual or deterministic rule
- Status: manual/default
- EAN Code: manual or deterministic rule
- Quantity: manual/default
- Package Weight, Length, Width, Height: manual verified facts
- Package CBM: calculated from dimensions
- Brand Name: manual/default
- Colour: manual or verified rule, not part of the two-line GPT output
- Enable Product: manual/default
- Vendor Product Description: GPT-5.6 SOL single-line HTML

### Price tab

- Vendor Price
- Vendor RRP

Both fields remain manual or deterministic calculations and are not generated by GPT-5.6 SOL.

### Shipping tab

Australian zones are always free. New Zealand shipping uses billable weight:

`billableWeightKg = max(actualWeightKg, lengthCm * widthCm * heightCm / 5000)`

- Billable weight below 3 kg: AUD 20
- Billable weight at or above 3 kg: AUD 40

The UI shows the derived rule summary instead of asking the operator to edit 166 individual regional values. The final DSZ payload expands the rule into the required zone-rate structure.

### Images tab

The tab shows five ordered image slots with per-role status, preview, replacement, and retry controls.

## UI Design

The optimized desktop workbench uses a restrained neutral palette with a violet accent consistent with the reference DSZ interface.

- A compact top bar shows application identity and Packy configuration health.
- A focused left rail contains source images, selling points, optional category guidance, and the single generation button.
- Two compact status cards show the independent GPT-5.6 SOL and GPT-Image-2 task states.
- Details, Price, Shipping, and Images tabs mirror the DSZ field model.
- Details fields are grouped into basic information, package and attributes, and product description.
- Only Product Name and Vendor Product Description carry an AI-generated indicator.
- Calculated fields such as CBM and shipping show a separate automatic indicator.
- A sticky bottom action bar shows validation completeness and the separate `Validate and Submit for Approval` action.
- On narrower screens, the source rail stacks above the form, field grids collapse to two columns, and summary cards stack.

The approved visual companion artifact is `.superpowers/brainstorm/20260711-150920/content/workbench-polished-v4.html`. This directory is a local brainstorming artifact and is not committed.

## Error Handling

- Missing source images or selling points block the combined action before either provider request starts.
- Text errors include a safe provider status and a user-facing validation reason, never the credential or raw authorization header.
- Image errors are tracked per role. Successful roles remain visible when another role fails.
- Text failure does not stop image generation; image failure does not stop text generation.
- Retrying one task does not clear or restart the other task.
- Existing title, description, and images are overwritten only by validated successful results.

## Testing Strategy

### Unit tests

- Load the exact system prompt file as UTF-8.
- Build the Packy text request with `gpt-5.6-sol` and the system prompt.
- Parse exactly two non-empty response lines.
- Reject extra lines, invalid title length, forbidden tags, multiline HTML, URLs, missing footer content, and Markdown fences.
- Build GPT-Image-2 requests for the five fixed roles.
- Calculate billable weight, the AUD 20 New Zealand rate, the AUD 40 New Zealand rate, and free Australian rates.

### API integration tests

- Text success and text validation failure.
- Five-role image success and individual role failure.
- Packy error responses do not expose credentials.
- Text and image dependency injection remains independent.

### UI tests

- One click starts both client tasks.
- Text success remains when images fail.
- Image success remains when text fails.
- Partial image results render in fixed roles.
- Retry controls invoke only the failed task.
- Generated copy updates only Product Name and Vendor Product Description.
- Shipping summary changes at the 3 kg billable-weight boundary.

### Verification commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Live browser verification of success, text failure, image partial failure, responsive layout, and final payload review

## Acceptance Criteria

1. One click starts text and image generation without coupling their outcomes.
2. GPT-5.6 SOL receives the exact user-owned system prompt and returns only a validated title and description.
3. GPT-Image-2 produces five ordered role-specific images without silent source-image fallback.
4. All reference DSZ fields appear in the four-tab interface.
5. Australian shipping is free and New Zealand shipping follows the approved billable-weight rule.
6. Failed tasks can be retried independently without losing successful results.
7. The Packy credential remains server-only and untracked.
8. Automated tests, type checking, linting, build verification, and browser verification pass before completion is claimed.
