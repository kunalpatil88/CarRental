# DP Self Drive — Car Rental Website + Admin Panel

A fast, mobile-first website for a self-drive car rental business, with a built-in
admin panel that controls every section of the home page. Liquid Glass design with
light and dark themes. No frameworks, no build step, no npm dependencies.

## Run it

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Double-click `start.bat` (Windows) or run `npm start` in this folder.
3. Site: <http://localhost:3000/> · Admin: <http://localhost:3000/admin.html>
4. Default admin password is `admin123`. Change it in **Admin → Settings → Security** right away (8+ characters).

Everything the admin publishes is written to `data/content.json`, and a copy of
every previous version is kept in `data/backups/` (last 30).

## What the admin panel controls

Works on a phone as well as a computer (bottom tab bar, full-screen car editor).

| Section | What you can edit |
| --- | --- |
| Dashboard | Available and booked cars at a glance, one-tap "mark available", site health checks, quick actions |
| Cars & availability | Add, edit, duplicate, reorder, hide, mark popular. Tap a car's status to mark it **booked until a date**: it shows "Free from …" on the site and becomes available again by itself. Daily, weekly and monthly prices (the site shows the cheapest total for the visitor's dates). Photos: upload, library, reorder, cover |
| Offers & posters | Rotating, swipeable poster carousel with captions, links and start/end dates |
| Announcement bar | Slim notice at the top of the site |
| Reviews | Customer testimonials with star rating |
| Social media | Profile links, Follow us section with embedded posts, share buttons |
| SEO & sharing | Google title and description with length counters, share image, live Google and WhatsApp previews |
| Hero, Stats, Why choose us, How it works, FAQ, Contact & footer | All text and images on the home page |
| Business & contact | Name, phone, WhatsApp, email, address, hours, map (with checks for wrong numbers and map links) |
| Logo & theme | Accent colour, default light/dark/auto look, visitor theme switch, optional custom logo and favicon |
| History | Restore any of the last 30 published versions |
| Security | Change the admin password |

Also: **Preview** (desktop or phone, light or dark) shows unsaved changes, **Undo** after
deleting anything, unsaved work is kept as a draft on the device, and if the site was
published from another device the admin asks before overwriting. `Ctrl+S` publishes,
`Ctrl+K` searches the settings.

## Folder layout

```
index.html            public site
admin.html            admin panel
server.js             zero-dependency Node server + JSON API
data/content.json     all site content (source of truth)
data/content.js       same content, used as a fallback when opened without a server
data/backups/         automatic backups on every publish
assets/css/           site.css, admin.css
assets/js/            site.js, admin.js, admin-theme.js, icons.js (icons + DP logo)
assets/img/cars/      optimised car photos (1400px + 720px thumbnails)
assets/img/uploads/   photos uploaded through the admin
assets/img/logo.svg   the DP logo (favicon.svg is the square mark)
admin.config.json     hashed admin password (created on first run, never served)
<car folders>         your original, untouched photos
```

## Deploying to Vercel (recommended, free)

The site is static and the admin talks to small serverless functions in `api/`.
Because Vercel's file system is read-only, **publishing from the admin commits to
your GitHub repo**, and Vercel redeploys automatically (about a minute).

1. **GitHub token** — github.com → Settings → Developer settings → Personal access
   tokens → *Fine-grained tokens* → Generate. Repository access: only `CarRental`.
   Permissions → Repository → **Contents: Read and write**. Copy the token.
2. **Import** — vercel.com → Add New → Project → Import `CarRental`. Framework
   preset: **Other**. Leave build and output settings empty.
3. **Environment variables** (same screen, before Deploy):

   | Name | Value |
   | --- | --- |
   | `ADMIN_PASSWORD` | the password for `/admin.html` |
   | `GITHUB_TOKEN` | the token from step 1 |
   | `GITHUB_REPO` | `kunalpatil88/CarRental` |
   | `GITHUB_BRANCH` | `main` |

4. **Deploy.** Site: `https://<project>.vercel.app/` · Admin: `/admin.html`.
5. Every later `git push` and every admin publish redeploys automatically.

## Deploying

**Own server / VPS:** copy the folder, run `npm start` (use `pm2` or a Windows
service to keep it running). Set `PORT` and optionally `ADMIN_PASSWORD` as
environment variables. Put it behind HTTPS (Caddy or nginx) before exposing the
admin to the internet.

**Static hosting (Netlify, GitHub Pages, cPanel):** upload everything except
`server.js`. The site works as-is. The admin opens in *static mode*: you can edit
and then **Export** `content.json` + `content.js` and upload them into `data/`.
Uploads and password protection need the Node server.

## Design

- **Colours:** pick the accent colour in Admin → Logo & theme. Everything else is a CSS
  variable at the top of `assets/css/site.css` (light values in `:root`, dark values in
  `:root[data-theme="dark"]`).
- **Glass:** only the floating controls use the glass material (header, booking card,
  filter bar, mobile dock, sheets). It turns solid automatically for visitors who ask for
  reduced transparency, on browsers without `backdrop-filter`, and on low-memory phones.
- **Icons** live in `assets/js/icons.js`, along with `brandMark()`, the DP logo.

## Security

The Node server only serves the site's own files (an allow-list), so the password file,
backups and original photos are never reachable. It sends a Content Security Policy and
other security headers, limits request sizes, and rate-limits sign-in and password changes.
On Vercel, set a long `ADMIN_PASSWORD`, and optionally `SESSION_SECRET`.
