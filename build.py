#!/usr/bin/env python3
"""Generate the static pages for Field Forecast.

Usage: python3 build.py --site https://yourdomain.com --repo https://github.com/you/field-forecast
Writes index.html, one page per species, one page per lower-48 state, privacy.html,
sitemap.xml and robots.txt into this folder.
"""
import argparse, datetime, html, json, pathlib

ap = argparse.ArgumentParser()
ap.add_argument("--site", default="https://example.com")
ap.add_argument("--repo", default="")
args = ap.parse_args()
SITE = args.site.rstrip("/")
ROOT = pathlib.Path(__file__).parent
TPL = (ROOT / "template.html").read_text()

STATES = [
 ("Alabama",32.8,-86.8),("Arizona",34.2,-111.7),("Arkansas",34.9,-92.4),("California",37.2,-119.5),
 ("Colorado",39.0,-105.5),("Connecticut",41.6,-72.7),("Delaware",39.0,-75.5),("Florida",28.6,-82.4),
 ("Georgia",32.7,-83.4),("Idaho",44.4,-114.6),("Illinois",40.0,-89.2),("Indiana",39.9,-86.3),
 ("Iowa",42.1,-93.5),("Kansas",38.5,-98.4),("Kentucky",37.5,-85.3),("Louisiana",31.1,-92.0),
 ("Maine",45.3,-69.2),("Maryland",39.0,-76.8),("Massachusetts",42.3,-71.8),("Michigan",44.3,-85.4),
 ("Minnesota",46.3,-94.3),("Mississippi",32.7,-89.7),("Missouri",38.4,-92.5),("Montana",47.0,-109.6),
 ("Nebraska",41.5,-99.8),("Nevada",39.3,-116.6),("New Hampshire",43.7,-71.6),("New Jersey",40.1,-74.7),
 ("New Mexico",34.4,-106.1),("New York",42.9,-75.5),("North Carolina",35.5,-79.4),("North Dakota",47.4,-100.5),
 ("Ohio",40.3,-82.8),("Oklahoma",35.6,-97.5),("Oregon",43.9,-120.6),("Pennsylvania",40.9,-77.8),
 ("Rhode Island",41.7,-71.5),("South Carolina",33.9,-80.9),("South Dakota",44.4,-100.2),("Tennessee",35.8,-86.3),
 ("Texas",31.5,-99.3),("Utah",39.3,-111.7),("Vermont",44.0,-72.7),("Virginia",37.5,-78.8),
 ("Washington",47.4,-120.5),("West Virginia",38.6,-80.6),("Wisconsin",44.6,-89.9),("Wyoming",43.0,-107.5),
]
ELK = {"Arizona","California","Colorado","Idaho","Montana","Nevada","New Mexico","North Dakota","Oregon","South Dakota","Utah","Washington","Wyoming"}
slug = lambda n: n.lower().replace(" ", "-")

SPECIES = {
 "deer": ("Deer", "deer-movement-forecast.html", "Deer Movement Forecast",
   "Free hourly deer movement forecast using pressure, temperature, wind, moon phase and rut timing for any location.",
   "Deer are mostly crepuscular, so dawn and dusk set the baseline. The forecast then adjusts for barometric pressure trend, a cold front or temperature drop, wind speed, rain, moon phase and where you are in the rut. The moon effect is weak in most studies, so it carries little weight."),
 "waterfowl": ("Waterfowl", "waterfowl-flight-forecast.html", "Duck and Goose Flight Forecast",
   "Free hourly waterfowl flight forecast based on cold fronts, pressure, wind, cloud cover and migration timing.",
   "Waterfowl respond strongly to weather fronts. The forecast rewards a temperature drop and rising barometer behind a front, moderate to strong wind with a small bonus for north and northwest flow, and overcast skies. It also weighs first and last light and estimated migration timing for your latitude."),
 "turkey": ("Turkey", "turkey-hunting-forecast.html", "Spring Turkey Hunting Forecast",
   "Free hourly turkey gobbling and activity forecast using wind, rain, temperature, pressure and breeding season timing.",
   "Spring gobbling is driven by time of day and weather. Fly-down around sunrise scores highest, with a second bump mid-morning. Wind over 10 mph hurts, rain and cold snaps reduce activity, and clear mornings from 50 to 72 degrees score best. Season timing is estimated from latitude."),
 "elk": ("Elk", "elk-activity-forecast.html", "Elk Activity and Rut Forecast",
   "Free hourly elk activity forecast using temperature, wind, light and rut timing.",
   "Elk are heat sensitive and most active at dawn and dusk. The forecast leans on temperature, wind, light and a rut calendar that peaks in late September. Elevation and terrain change timing, so use the score as a starting point."),
 "upland": ("Upland", "upland-bird-hunting-forecast.html", "Upland Bird Hunting Forecast",
   "Free hourly upland bird hunting forecast for pheasant, grouse and quail using wind, temperature, moisture and season timing.",
   "This is the least certain model. Wind is the main driver, since past 12 mph birds flush wild and dogs lose scent. Cool temperatures and damp air help dogs and birds. Season windows are rough and vary by state and species."),
}

def clamp(x, a, b): return max(a, min(b, x))
def fmt(doy):
    n = int(round(doy))
    if n > 365: n -= 365
    d = datetime.date(2026, 1, 1) + datetime.timedelta(days=n - 1)
    return f"{d:%b} {d.day}"

def estimates(name, lat):
    deer = 316 + clamp(38 - lat, 0, 70) * 6
    water = 301 + clamp(45 - lat, -10, 25) * 3
    turkey = 120 - clamp(42 - lat, 0, 15) * 3.5
    rows = [
      ("Deer rut, seeking to peak breeding", f"{fmt(deer-12)} to {fmt(deer+10)}"),
      ("Waterfowl peak migration", f"{fmt(water-20)} to {fmt(water+15)}"),
      ("Spring turkey peak gobbling", f"{fmt(turkey-10)} to {fmt(turkey+10)}"),
    ]
    if name in ELK: rows.append(("Elk peak rut (varies with elevation)", "Sep 20 to Oct 7"))
    return rows, deer

def table(rows):
    body = "".join(f"<tr><td>{html.escape(a)}</td><td>{html.escape(b)}</td></tr>" for a, b in rows)
    return f"<table><tr><th>Season marker</th><th>Model estimate</th></tr>{body}</table>"

def states_html():
    return " ".join(f'<a href="{slug(n)}-hunting-forecast.html">{n}</a>' for n, _, _ in STATES)

def page(file, title, desc, h1, lede, content, preset, canon=None):
    src = f'<a href="{html.escape(args.repo)}">Source</a>' if args.repo else ""
    canon = canon or f"{SITE}/{file}"
    out = (TPL.replace("{{TITLE}}", html.escape(title)).replace("{{DESC}}", html.escape(desc))
        .replace("{{CANON}}", canon).replace("{{H1}}", html.escape(h1)).replace("{{LEDE}}", html.escape(lede))
        .replace("{{CONTENT}}", content).replace("{{STATES}}", states_html()).replace("{{SRC}}", src)
        .replace("{{PRESET}}", json.dumps(preset)))
    (ROOT / file).write_text(out)

GENERIC = """
<h2>How the forecast works</h2>
<p>Each hour gets a score from 0 to 100. Light and time of day carry the most weight, followed by weather factors that differ by species: barometric pressure trend, temperature and cold fronts, wind, rain and cloud cover, moon phase, and a season calendar estimated from your latitude.</p>
<p>Weather comes from the free Open-Meteo service for your exact location, so the numbers update as the forecast changes. The scores are rules of thumb drawn from hunting research and field reports. They are not a validated model, and nothing replaces local knowledge. Use the hunt log to compare the score with what you actually see.</p>
<h2>Keep your own hunt log</h2>
<p>Pick a day and the forecast numbers for it load automatically. Record when you hunted, whether you saw anything and when, and your notes. After a few hunts the log shows how your results line up with the scores. Your log stays on your device.</p>
"""

pages = []
def add(f): pages.append(f)

# home
sp_links = " ".join(f'<a href="{v[1]}">{v[0]}</a>' for v in SPECIES.values())
page("index.html", "Hunting Forecast: Deer, Waterfowl, Turkey, Elk and Upland | Field Forecast",
  "Free hourly hunting forecasts for deer, waterfowl, turkey, elk and upland birds, with a built-in hunt log. Weather, pressure, moon and season for your location.",
  "Hunting forecast for any location and day",
  "Free hourly activity scores for deer, waterfowl, turkey, elk and upland birds, plus a hunt log that saves the forecast with every trip.",
  GENERIC + f"<h2>Forecasts by species</h2><p>{sp_links}</p>", {})
add("index.html")

for k, (name, file, h1, desc, blurb) in SPECIES.items():
    page(file, f"{h1} | Field Forecast", desc, h1, desc,
         f"<h2>What drives the {name.lower()} score</h2><p>{html.escape(blurb)}</p>" + GENERIC, {"sp": k})
    add(file)

for name, lat, lon in STATES:
    file = f"{slug(name)}-hunting-forecast.html"
    rows, deer = estimates(name, lat)
    delta = int(round(deer - 316))
    rel = (f"about {delta} days later than the northern reference peak of Nov 12" if delta > 3
           else "close to the northern reference peak of Nov 12")
    content = (f"<h2>{name} season timing estimates</h2>"
      f"<p>At about {lat:.1f} degrees north, {name} falls where the model puts the deer rut {rel}. "
      f"These markers come from a latitude-based model and are not wildlife agency data. Elevation, local herds and weather shift real timing, "
      f"and hunting seasons, bag limits and legal hours are set by the {name} wildlife agency, so check their current regulations before you go.</p>"
      + table(rows)
      + "<p>The forecast above starts at the middle of the state. Search your own town or tap Use my location for numbers at your stand.</p>" + GENERIC)
    page(file, f"{name} Hunting Forecast: Deer, Waterfowl, Turkey | Field Forecast",
      f"Free hourly hunting forecast for {name}: deer movement, waterfowl flights, turkey and more, with rut and migration timing estimates.",
      f"{name} hunting forecast", f"Hourly activity scores for hunters in {name}, with season timing estimates for deer, waterfowl and turkey.",
      content, {"name": f"{name} (state center)", "lat": lat, "lon": lon, "force": True, "sp0": "deer"})
    add(file)

# privacy
priv = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy | Field Forecast</title><link rel="stylesheet" href="style.css"></head><body>
<header class="top"><a href="index.html">Field Forecast</a></header>
<h1>Privacy</h1>
<p class="mute">Template text. Have it reviewed and edit it so it matches what your site actually does before you rely on it.</p>
<h2>Location and weather</h2><p>When you search for a place or tap Use my location, the coordinates are sent to Open-Meteo to look up weather. We do not store them on a server. Your last location is saved in your browser so the page can reopen where you left off.</p>
<h2>Your hunt log</h2><p>Hunt logs are stored in your browser on your device. We cannot see them. Clearing your browser data deletes them, so export a CSV for a backup.</p>
<h2>Ads and cookies</h2><p>If ads are turned on, the page asks before loading them. Advertising partners such as Google may use cookies to show and measure ads. If you decline, no ad scripts load. You can change your choice by clearing this site's data in your browser.</p>
<h2>Affiliate links</h2><p>Some links to gear are affiliate links. If you buy through one, the site may earn a commission at no extra cost to you.</p>
<h2>Contact</h2><p>Add your contact email or link here.</p>
<p><a href="index.html">Back to the forecast</a></p></body></html>"""
(ROOT / "privacy.html").write_text(priv)

urls = "".join(f"<url><loc>{SITE}/{'' if f=='index.html' else f}</loc></url>" for f in pages + ["privacy.html"])
(ROOT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>')
(ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
print(f"Built {len(pages)+1} pages for {SITE}")
