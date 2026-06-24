# Product AI Workbench Design

## Goal

Build a local internal web app for operations staff to prepare Dropshipzone supplier products with AI-generated copy and Packy image-to-image assets, then submit the reviewed product payload to a configurable admin API.

## Scope

The first version supports one product draft at a time. Users upload source images, fill product facts, generate titles and descriptions, generate detail images through Packy, review all fields, and submit the final payload.

The app will not auto-publish products without human review. It will not implement user accounts, batch import, or irreversible destructive actions.

## Architecture

The app uses React + Vite for the browser UI and an Express API server for provider calls. The browser never sees API keys. The server reads `PACKY_API_KEY`, Packy model settings, and Dropshipzone admin API settings from environment variables.

The Dropshipzone uploader is an adapter. `ADMIN_API_BASE_URL` defaults to `https://services.dropshipzone.com.au/admin/api/supplier/v1`, but product and image upload paths stay configurable because the public Swagger definition requires authorization.

## Primary Workflow

1. User fills base product fields and adds source images.
2. User generates AI copy.
3. User generates Packy image-to-image outputs from one source image and a prompt.
4. User reviews generated fields and images.
5. User submits the draft to the admin uploader.
6. The app displays success, mock, or actionable failure status.

## Validation

Product submission requires a title, at least one image URL, a product type, and a SKU. Missing configuration must return clear server errors instead of silent failures.
