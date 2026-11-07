# Calorie Tracker

A calorie and macro tracker that runs in your phone's browser and can be added to the Home Screen like an app.

- **Scan barcode.** Live camera scanning with a lookup in [Open Food Facts](https://world.openfoodfacts.org), a free food database. If a product isn't listed, photograph its Nutrition Facts label once and it's saved.
- **Snap meal.** Claude identifies each food and estimates its grams, calories, protein, carbs and fat. Edit the grams and the numbers update.
- **Track.** Daily calorie ring, macro bars, a 7-day chart, quick re-add, and past days.

Everything is stored in your browser. Your Claude API key is only ever sent to Anthropic. Use **Settings → Export backup** now and then.

## Put it online (GitHub Pages)
1. Create a new **public** repository on GitHub, e.g. `calorie-tracker`.
2. Upload every file in this folder (Add file → Upload files, select them all).
3. In the repo go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute your app is at `https://<your-username>.github.io/calorie-tracker/`.

## Use it on iPhone
1. Open that link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the Home Screen, tap ⚙︎, and paste a Claude API key from https://console.anthropic.com/settings/keys. Barcode scanning works without a key.

## Files
`index.html` · `styles.css` · `app.js` (all app logic) · `sw.js` (offline support) · `zxing-browser.min.js` (barcode decoder, Apache-2.0)
