# CHRONO VAULT — Watch Store with Hidden Admin Panel

Full-stack watch sale website. Public storefront + secret, password-protected admin URL. All data lives in a local SQLite database (`store.db`) that only the admin can see.

## Run it

```bash
npm install
node server.js
```

- **Store (customers):** http://localhost:3000/
- **Admin panel (you):** http://localhost:3000/vault-admin-x7k2
- **Default password:** `admin123` → change it immediately from Admin → Security

## How the secret admin URL works

The admin panel is served ONLY at the path defined in `config.json`:

```json
{ "adminPath": "/vault-admin-x7k2", "port": 3000 }
```

Change `adminPath` to anything you like (e.g. `/irfan-panel-9k3x`), restart the server, and the panel moves. Visiting `/admin` or any other path returns 404 — nobody can find it by guessing. Even if someone finds the URL, they still need the password (scrypt-hashed in the DB, 5 wrong attempts = 5-minute lockout).

## What's stored in the database (admin-only)

| Table | Data |
|---|---|
| `watches` | name, brand, price, sale price, image, stock, featured |
| `orders` | customer name, phone, city, address, **GPS lat/lng + accuracy** |
| `visitors` | IP, device/user-agent, timestamp, GPS if shared |
| `settings` | every editable text on the live site |
| `admin` | salted + hashed password |

Customer location: when placing an order, the customer taps "Share my location" — the browser asks permission and the exact coordinates are attached to the order. In the admin Orders tab you get an "Open map ↗" link that opens the delivery point in Google Maps.

## Editing the live website from the admin URL

Admin → **Site Editor** lets you change the site name, hero heading, tagline, announcement bar, phone, WhatsApp, email and address. Click "Publish changes" and the public site updates instantly — no code editing, no redeploy.

Admin → **Watches** = add / edit / delete products, set sale prices and stock.
Admin → **Orders** = update status (pending → confirmed → shipped → delivered) or delete.
Admin → **Visitors** = who opened the site, from which IP/device.

## Deploying (Render / Railway / your usual flow)

1. Push the folder to GitHub, deploy as a Node web service (`node server.js`, port from `process.env.PORT`).
2. Frontend and backend are served together — one deployment, no CORS setup needed.
3. Note: SQLite file is on local disk; on free tiers with ephemeral storage, attach a persistent disk or the DB resets on redeploy.
4. Geolocation in browsers **requires HTTPS** (localhost is exempt) — deployed hosts give you HTTPS automatically.

## Files

```
server.js          → Express API + SQLite + auth (secret path, scrypt password)
public/index.html  → storefront (single file, fully responsive)
admin.html         → admin panel (single file, served only at secret path)
config.json        → adminPath + port (auto-created on first run)
store.db           → SQLite database (auto-created on first run)
```
