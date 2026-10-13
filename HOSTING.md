# InsuriCare Website — Hosting Guide

This is a static site (one `index.html` + an `assets/partners/` folder of
images). No build step, no server code — so it can be hosted almost anywhere
for free.

## Fastest option: Netlify Drop (no account needed to preview)

1. Go to https://app.netlify.com/drop
2. Drag the whole `insuricare_site` folder onto the page.
3. It deploys instantly and gives you a live URL like `random-name.netlify.app`.
4. (Optional) Create a free Netlify account to keep the site, rename the
   subdomain, and later attach your own domain (e.g. `insuricareagency.co.ke`).

## Recommended for a permanent free site: Netlify or Vercel (with GitHub)

1. Create a free GitHub account if you don't have one, and a new repository
   (e.g. `insuricare-website`).
2. Upload `index.html` and the `assets/` folder to that repo (GitHub's web
   UI has an "Add file → Upload files" button — no command line needed).
3. Go to https://netlify.com or https://vercel.com, sign up with GitHub,
   and choose "Import project" / "Add new site" → select your repo.
4. Leave build settings blank (it's a static site — no build command,
   publish directory is the repo root).
5. Deploy. You'll get a free `.netlify.app` or `.vercel.app` URL immediately.

## Using your own domain (e.g. insuricareagency.co.ke)

1. Buy the domain from a registrar (Truehost, Safaricom, or Namecheap all
   work well for `.co.ke` / `.com`).
2. In Netlify/Vercel: Site settings → Domain management → Add custom domain.
3. They'll give you DNS records (usually a CNAME or A record) to add at
   your domain registrar. Once added, it usually takes 10 minutes–24 hours
   to go live with free HTTPS included automatically.

## Alternative: GitHub Pages (also free)

1. In your GitHub repo, go to Settings → Pages.
2. Under "Source," choose the `main` branch and `/ (root)` folder.
3. Save — GitHub gives you a URL like `yourusername.github.io/insuricare-website`.
4. Custom domains are supported the same way as above (add a `CNAME` file
   with your domain name, plus DNS records at your registrar).

## What to check after deploying

- Click through **Get a Quote**, **File a Claim**, the floating WhatsApp
  button, and the quote form — each should open WhatsApp
  (wa.me/254115129088) with a pre-filled message.
- Test on a phone — WhatsApp links open the app directly on mobile;
  on desktop without WhatsApp Desktop installed, they open web.whatsapp.com.
- Confirm the partner logos load (`assets/partners/*.jpg`) — if you move
  files around, keep that folder structure relative to `index.html`.

## Phone calls, AI assistant and alerts
Tap-to-call and the "Request a call" form are included. To switch on the WhatsApp assistant and owner
alerts, follow `AUTOMATION.md` (environment variables go in Vercel project settings, not in the code).
