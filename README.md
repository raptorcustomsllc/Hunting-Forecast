# Field Forecast

Free hourly hunting forecasts for **deer, waterfowl, turkey, elk and upland birds**, with a built-in hunt log that saves the forecast numbers with every trip. Plain HTML, CSS and JavaScript. No framework, no backend, no API key.

- Pick a location (search or GPS) and a day up to 15 days out, then switch species.
- Each hour gets a 0 to 100 score from light, pressure, temperature or fronts, wind, sky, moon and season.
- The hunt log stores the day, hunt time, sightings with times, harvest and notes in the browser. Opening a past or future day pulls that day's weather automatically. CSV export included.
- Installs as an app on Android (Chrome menu, Install app).
- 48 state pages and 5 species pages are generated for search traffic.

## Run it

```
python3 -m http.server 8000      # then open http://localhost:8000
```

## Build the pages

`index.html`, the species pages, the state pages, `sitemap.xml` and `robots.txt` are generated from `template.html`:

```
python3 build.py --site https://yourdomain.com --repo https://github.com/you/field-forecast
```

Edit `template.html` or `build.py`, then rebuild. Edit the scoring models in `app.js` (the `SP` object).

## Deploy

Any static host works: Cloudflare Pages, Netlify, GitHub Pages, Vercel. Upload the folder. Serve over HTTPS so the app can be installed.

## Settings (`config.js`)

| Setting | What it does |
|---|---|
| `ADSENSE_CLIENT`, `AD_SLOTS` | Google AdSense ids. Ads load only after a visitor accepts the cookie prompt. |
| `AFFILIATE` | Gear links shown under the forecast, per species. Shown with a disclosure. |
| `DONATE_URL` | Adds a support link in the footer. |

Leave a value empty to switch that feature off. Update the privacy page text (in `build.py`) to match what you turn on, and have it reviewed.

## Before you monetize

- **Weather data terms.** Weather and geocoding come from [Open-Meteo](https://open-meteo.com/), which requires attribution (included in the footer). Its free tier is for non-commercial use. A site with ads is commercial, so read their terms and use their paid plan or another data source (change the URLs in `app.js`).
- **Season dates are estimates.** The rut, migration and gobbling calendars are modeled from latitude. They are not wildlife agency data. The pages say so and tell users to check state regulations.
- **Scores are rules of thumb**, not validated science. Please improve them. If you have hunt-log data, open an issue or pull request.

## Ideas

Optional accounts and cloud sync (Supabase or Firebase), pooled opt-in data to tune the weights, more species, moon rise and set times, wind-direction stand advice.

## Docs

- `docs/LAUNCH-GUIDE.md`: step-by-step hosting options, domain, search setup, ads and affiliate setup.
- `docs/WEATHER-DATA.md`: weather data options, costs, and the paid-key proxy setup (`worker/`).

## License

MIT. See `LICENSE`.
