# DriveEase — Self Drive Car Rental Website + Admin Panel

A fast, mobile-first website for a self-drive car rental business, with a built-in
admin panel that controls every section of the home page. No frameworks, no build
step, no npm dependencies.

## Run it

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Double-click `start.bat` (Windows) or run `npm start` in this folder.
3. Site: <http://localhost:3000/> · Admin: <http://localhost:3000/admin.html>
4. Default admin password is `admin123`. Change it in **Admin → Security** right away.

Everything the admin publishes is written to `data/content.json`, and a copy of
every previous version is kept in `data/backups/` (last 30).

## What the admin panel controls

| Section | What you can edit |
| --- | --- |
| Business & contact | Name, tagline, phone, WhatsApp number, email, address, hours, map, announcement bar |
| Hero banner | Headline, highlighted line, subtitle, buttons, trust badges, background photo |
| Stats strip | The four numbers under the hero |
| Offers & posters | Auto-rotating, swipeable poster carousel under the stats strip: upload festival or discount posters, add optional captions, buttons and links, schedule start and end dates, set rotation speed |
| Fleet / cars | Add, edit, duplicate, reorder, hide, mark booked or popular. Photos: upload (auto-resized), pick from library, reorder, set cover |
| Why choose us | Feature cards with icons |
| How it works | Booking steps |
| Reviews | Customer testimonials with star rating |
| Social media | Profile links for any platform (Instagram, Facebook, YouTube, Google, X, LinkedIn, Threads, Telegram, custom), where icons show (header, footer, contact), a Follow us section with embedded Instagram / YouTube / Facebook posts, and share buttons on every car |
| FAQ | Questions and answers |
| Contact & footer | Contact section text, footer about text, copyright |
| SEO | Browser title, meta description, keywords |
| Backups | Restore any previously published version |
| Security | Change the admin password |

Extra: **Preview** shows unsaved changes live (desktop and mobile widths), **Export /
Import** moves `content.json` between machines, and `Ctrl+S` publishes.

## Folder layout

```
index.html            public site
admin.html            admin panel
server.js             zero-dependency Node server + JSON API
data/content.json     all site content (source of truth)
data/content.js       same content, used as a fallback when opened without a server
data/backups/         automatic backups on every publish
assets/css/           site.css, admin.css
assets/js/            site.js, admin.js, icons.js
assets/img/cars/      optimised car photos (1400px + 720px thumbnails)
assets/img/uploads/   photos uploaded through the admin
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

## Customising the design

Colours, fonts and spacing are CSS variables at the top of `assets/css/site.css`
(`--accent`, `--navy`, `--font-head`, …). Icons live in `assets/js/icons.js`.
