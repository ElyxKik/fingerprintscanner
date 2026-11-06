# FingerprintScanner

**Discover your digital footprint. Take back your privacy.**

FingerprintScanner is a full-stack Next.js application. The UI and REST API run as Next.js routes; no Python service, Redis worker, or separately hosted API is required. The browser only calls same-origin `/api` routes.

## Local development

Requirements: Node.js 20+ and npm.

```sh
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The local API stores data in `frontend/data/fingerprintscanner.db`; this file is ignored by Git. Local account registration prints the one-hour confirmation link in the Next.js terminal. Add a Brave Search API key to `frontend/.env.local` to enable live public search; without it the scan still returns the curated catalogue and the clearly labelled fictional examples.

## Vercel deployment

Deploy the `frontend` directory as the Vercel project root, using the Next.js preset and `npm run build`. A local SQLite file is only suitable for local development. Configure a persistent Turso database for deployment and set:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `AUTH_SECRET` (long, random secret)
- `PII_ENCRYPTION_KEY` (independent long, random secret)
- `RESEND_API_KEY` and `EMAIL_FROM` so new accounts can receive address confirmation
- `BRAVE_SEARCH_API_KEY` if live web search is wanted
- `APP_URL` to the public HTTPS origin
- `CHARIOW_API_KEY`, `CHARIOW_GUIDED_PRODUCT_ID`, and `CHARIOW_COMPLETE_PRODUCT_ID` for the two published cleanup offers
- `CHARIOW_PULSE_SECRET` for the webhook signing secret shown in Chariow's Pulse settings

The API returns a configuration error if deployed without its persistent database. Email confirmation is required before password sign-in. Do not use the local SQLite fallback for production data.

## Included features

- French responsive landing page, dedicated scan page, and animated global scan visualization
- Free scans using the optional Brave Search API, merged with the manually curated `frontend/data/websites.json` catalogue
- Risk classification and ordering based on the catalogue danger keywords
- Account registration and password sign-in, with Scrypt password hashing and one-hour e-mail verification links
- Private dashboard, account deletion, and authorization checks for scans, drafts, and orders
- User-reviewed removal request drafts; no automatic contact with third-party sites
- $199/$299 annual license orders are created from the pricing page or after selecting cleanup findings, then passed to Chariow Checkout; verified Pulse webhooks update payment status. Licenses last one year and require a new purchase to renew.

## Current boundaries

Catalogue entries are informational and do not prove that an address appears on a listed website. Live scans query public search results only; the app does not bypass authentication, scrape restricted pages, or submit deletion requests automatically. Chariow requires published product IDs and supports API checkout for downloadable, course, license, and bundle products; service/coaching and pay-what-you-want products must use Chariow's storefront or Snap Widget instead.
