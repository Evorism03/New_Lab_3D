# Лаборатория 3Д — Order Platform

Instant-quote 3D printing order platform (Formlabs "Form Now" clone), styled and branded to
match [lab-3d.pro](https://lab-3d.pro): upload an STL/OBJ file, get an automatic price based on
geometry and material, configure options, pay, and track the order through production. Next.js 16
(App Router) + PostgreSQL/Prisma, with a JSON API meant to be consumed by other systems (not just
this frontend). Bilingual UI (EN/RU) via a cookie-based locale switcher.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4)
- PostgreSQL via Prisma 7 (`@prisma/adapter-pg` driver adapter)
- Auth.js (NextAuth v5, credentials provider) for the admin panel
- Stripe Checkout for payment
- `@react-three/fiber` + `three` for the in-browser 3D preview
- Custom STL/OBJ parsers (`lib/geometry`) for volume/bounding-box calculation — no native deps

## Getting started

```bash
npm install

# start a local Postgres instance (Prisma's bundled dev server)
npx prisma dev -d -n formnow

# apply the schema and seed materials + an admin user
npx prisma migrate dev
npx prisma db seed

npm run dev
```

Open http://localhost:3000. Seeded admin login (for `/admin/orders`): `admin@formnow.local` / `admin12345`.

### Environment variables (`.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (set for you by `prisma dev`) |
| `AUTH_SECRET` | Auth.js session secret — replace the placeholder before deploying |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | From the [Stripe test dashboard](https://dashboard.stripe.com/test/apikeys); checkout returns a 503 until these are set |
| `NEXT_PUBLIC_APP_URL` | Used to build Stripe redirect URLs |

To test the full payment flow, forward Stripe webhooks locally with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Project layout

- `app/order/upload`, `app/order/configure/[fileId]`, `app/order/checkout`, `app/order/[orderId]/status` — customer flow
- `app/admin/orders` — order queue + status transitions (admin-only)
- `app/api/*` — JSON API (materials catalog, quoting, orders, files, Stripe) — the same endpoints power the frontend and are meant for external integration
- `lib/geometry` — STL/OBJ parsing and volume/bounding-box calculation
- `lib/pricing/engine.ts` — pure pricing function shared by the quote endpoint and order creation
- `lib/storage` — storage adapter (local disk in dev; swap the implementation for S3 in production)
- `fixtures/` — a known-volume 10mm test cube (STL + OBJ, expected volume 1 cm³) for manually verifying the geometry pipeline

## Scope notes

MVP supports **STL and OBJ** only. 3MF/STEP (which the real Form Now also accepts) are not
implemented — `lib/geometry` is structured with one parser per format behind a common interface
so adding them later doesn't require touching pricing, upload, or viewer code.
