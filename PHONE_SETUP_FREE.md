# Fitness App V1: Free iPhone Setup

The local `localhost` version is only for building. For real iPhone use, publish the app as a free HTTPS website, then add it to the iPhone Home Screen.

## Best Free Path

1. Create a free Netlify account or use GitHub Pages / Cloudflare Pages.
2. Upload or deploy this folder:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `manifest.json`
   - `sw.js`
   - `icon.svg`
3. Open the HTTPS site on your iPhone in Safari.
4. Tap Share, then Add to Home Screen.

## Why This Fixes The Phone Problem

- Camera and barcode scanning need HTTPS on iPhone.
- `localhost` only works on the computer running the server.
- `file://` has different storage and breaks app-like behavior.
- A hosted HTTPS URL gives the phone one stable place to save the app data.

## Free Storage Plan

The app stores data on the phone using browser storage. That costs nothing.

Tradeoff: data stays on that phone unless export/import or cloud sync is added later.

## Daily Use

Open Fitness from the Home Screen icon. It should start on Dashboard and keep your food, weight, and lift data on that device.
