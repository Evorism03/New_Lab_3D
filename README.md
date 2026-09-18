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

Open http://localhost:3000. Seeded dev admin login (for `/admin`): `admin` / `admin`.

## Running on a Windows server (static IP, HTTPS, domain)

Works like a VPS: the site listens on the machine's IP behind [Caddy](https://caddyserver.com), which
provides HTTPS, and runs as a **background process** — closing the terminal does not stop it.
Everything is managed from one menu: double-click `server.bat` (or run it in a terminal). It asks for
administrator rights itself.

```powershell
winget install OpenJS.NodeJS.LTS PostgreSQL.PostgreSQL.17 CaddyServer.Caddy   # once, if missing
server.bat            # the menu
```

| Menu item | What it does |
| --- | --- |
| 6 Setup | first install or change of domain: detects the IP, writes `.env.production`, creates the database, admin, build, firewall |
| 1 / 2 / 3 Start · Stop · Restart | run the site in the background; reopen the menu any time to see the status or stop it |
| 4 Logs | live view of the site / Caddy / supervisor logs (Q to go back) |
| 5 Update | `git pull` (optional), dependencies, database schema, rebuild, restart |
| 7 Autostart | start with Windows (no login needed) and restart after a crash |
| 8 Cleanup | build cache and old logs; uploaded models that never became an order; stray files |
| 9 Uninstall | removes autostart, the firewall rule, settings and logs — the database and `uploads/` stay |

The same actions work without the menu: `server.bat start | stop | restart | status | logs | update | setup | autostart | cleanup | uninstall`
(also as `npm run server:start` etc.). A supervisor (`deploy/start.ps1`) restarts the site or Caddy if they crash.

- **Domain:** enter it in Setup and create a DNS `A` record to the server's public IP. Ports 80 and 443 must be reachable from the internet (forward them on the router if the PC is behind one). Without a domain the site opens on `https://<IP>` with a self-signed certificate (the browser warns).
- **Port 80/443 busy?** IIS or another web server holds them; stop it first (Start tells you what is using the port).
- **Data to back up:** the PostgreSQL database and the `uploads/` folder.
- **Stripe:** fill `STRIPE_*` in `.env.production` and restart. Payments are created in rubles, which Stripe does not offer to most Russian accounts — plan a Russian payment provider.

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
