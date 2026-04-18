# Porch PO Box Backend

This repo contains the production backend/API for Porch P.O. Box.

## Responsibility

- Email delivery for vendor registration
- Payment and other server-side business logic
- API routes consumed by the frontend
- Secret-backed integrations such as Resend and Stripe

## Production Mapping

- Backend repo: `nickperez1285/poboxbackend`
- Backend deployment: Vercel backend project
- Production API base URL: `https://poboxbackend.vercel.app`
- Frontend repo: `nickperez1285/porchpoboxfrontend`

## Current Email Flow

Vendor registration email route:

- `POST /api/notifications/vendor-registration`

This route is responsible for:

- sending an admin notification to `contact@porchpobox.com`
- sending a confirmation email to the vendor

## Important Backend Env Vars

- `RESEND_API_KEY`
- `MAIL_FROM_EMAIL`
  - recommended current sender: `no-reply@send.porchpobox.com`
  - switch to `no-reply@porchpobox.com` only after the root domain is verified for sending
- `FRONTEND_URL`

If Stripe is re-enabled later, also restore any Stripe-specific env vars required by the payment routes.

## Frontend Contract

The frontend should call this backend via `REACT_APP_API_URL`.

The frontend repo should not contain the production mail implementation.

## Notes

- If vendor registration succeeds in Firebase but emails fail, inspect this backend deployment and its Vercel env vars first.
- If Vercel is connected to this repo, production backend fixes must be made here.
