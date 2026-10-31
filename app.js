/* Field Forecast: location search, hourly species scores and a local hunt log.
   Weather and geocoding: Open-Meteo (https://open-meteo.com). No key needed. */
(function () {
  "use strict";
  var CFG = window.CONFIG || {};
  var PRESET = window.PRESET || {};
  var $ = function (id) { return document.getElementById(id); };
  var GEO = "https://geocoding-api.open-meteo.com/v1/search";
  var FC = "https://api.open-meteo.com/v1/forecast";
  var ARC = "https://archive-api.open-meteo.com/v1/archive";
  var HOURLY = "temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation";
  var DAYS_AHEAD = 15, PAST_FC = 85;

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function g(x, mu, s) { return Math.exp(-((x - mu) * (x - mu)) / (2 * s * s)); }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); }
  function today() { return iso(new Date()); }
  function dayDiff(a, b) { return Math.round((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 864e5); }
  function doy(s) { var d = new Date(s + "T12:00:00"); return Math.round((d - new Date(d.getFullYear(), 0, 1, 12)) / 864e5) + 1; }
  function hrOf(t) { var m = /T(\d\d):(\d\d)/.exec(t); return m ? +m[1] + m[2] / 60 : 12; }
  function hm(h) { h = ((h % 24) + 24) % 24; var H = Math.floor(h), M = Math.round((h - H) * 60); if (M === 60) { H++; M = 0; } var ap = H < 12 || H === 24 ? "AM" : "PM"; var h12 = H % 12 || 12; return h12 + (M ? ":" + String(M).padStart(2, "0") : "") + " " + ap; }
  function toH(v) { var p = String(v || "0:0").split(":"); return +p[0] + (+p[1] || 0) / 60; }
  function fmtDay(s) { return new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function label(s) { return s >= 75 ? "Excellent" : s >= 60 ? "Good" : s >= 45 ? "Fair" : "Slow"; }
  function color(s) { return s >= 75 ? "#f26a1b" : s >= 60 ? "#e0a53a" : s >= 45 ? "#9fb26b" : "#5f7a64"; }
  function compass(d) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((d % 360) + 360) % 360 / 45) % 8]; }

  /* ---------- moon ---------- */
  function moon(s) {
    var syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
    var age = (((new Date(s + "T12:00:00Z") - ref) / 864e5) % syn + syn) % syn;
    var illum = (1 - Math.cos(2 * Math.PI * age / syn)) / 2;
    var names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
    return { illum: illum, name: names[Math.round(age / syn * 8) % 8] };
  }

  /* ---------- season calendars (match build.py estimates) ---------- */
  function seasonDist(d, peak) { var x = Math.abs(d - peak); return Math.min(x, 365 - x); }
  function rutPeak(lat) { return 316 + clamp(38 - lat, 0, 70) * 6; }
  function waterPeak(lat) { return 301 + clamp(45 - lat, -10, 25) * 3; }
  function turkeyPeak(lat) { return 120 - clamp(42 - lat, 0, 15) * 3.5; }

  /* ---------- light curves: 0..1 by hour, relative to sunrise (sr) and sunset (ss) ---------- */
  function legal(h, c) { return h >= c.sr - 0.5 && h <= c.ss + 0.5; }

  /* ---------- scoring models ----------
     Each factor returns 0..1 and a short note; w is the max points. Weights sum to 100. */
  var SP = {
    deer: {
      name: "Deer", w: { light: 35, pressure: 15, temp: 15, wind: 10, sky: 8, moon: 5, season: 12 },
      about: "Deer are mostly crepuscular, so dawn and dusk set the baseline. The forecast then adjusts for barometric pressure trend, a cold front or temperature drop, wind speed, rain, moon phase and where you are in the rut. The moon effect is weak in most studies, so it carries little weight.",
      light: function (h, c) { return legal(h, c) ? 0.15 + 0.85 * Math.max(g(h, c.sr + 0.25, 0.9), g(h, c.ss - 0.25, 0.9)) : 0.05; },
      pressure: function (x) { var d = x.dp3; if (d >= 0.5 && d <= 2.5) return [1, "Rising"]; if (Math.abs(d) < 0.5) return [x.p >= 1016 ? 0.8 : 0.6, "Steady"]; if (d < -1.5) return [0.65, "Falling fast, pre-front feeding"]; if (d < 0) return [0.45, "Falling"]; return [0.7, "Rising fast"]; },
      temp: function (x) { var s = x.dT24 <= -8 ? 1 : x.dT24 <= -3 ? 0.85 : x.dT24 < 4 ? 0.6 : 0.35; if (x.temp > 75) s *= 0.4; else if (x.temp > 65) s *= 0.7; return [s, x.dT24 <= -3 ? "Cooler than yesterday" : x.dT24 >= 4 ? "Warmer than yesterday" : "Near yesterday"]; },
      wind: function (x) { var v = x.wind; return [v < 3 ? 0.75 : v <= 12 ? 1 : v <= 18 ? 0.55 : 0.2, v <= 12 ? "Light to moderate" : v <= 18 ? "Breezy" : "Strong"]; },
      sky: function (x) { var r = x.precip; if (r > 0.1) return [0.25, "Heavy rain"]; if (r > 0) return [0.7, "Light rain"]; return [x.cloud > 60 ? 0.9 : 0.75, x.cloud > 60 ? "Overcast" : "Clear to partly cloudy"]; },
      moon: function (x) { return [0.5 + 0.5 * (1 - x.moon), "Little effect in most studies"]; },
      season: function (x) { var d = seasonDist(x.doy, rutPeak(x.lat)); return [d <= 12 ? 1 : d <= 30 ? 0.75 : d <= 50 ? 0.5 : 0.3, d <= 12 ? "Near peak rut" : d <= 30 ? "Rut building or winding down" : "Outside the rut"]; }
    },
    waterfowl: {
      name: "Waterfowl", w: { light: 25, pressure: 12, temp: 20, wind: 18, sky: 10, moon: 3, season: 12 },
      about: "Waterfowl respond strongly to weather fronts. The forecast rewards a temperature drop and rising barometer behind a front, moderate to strong wind with a small bonus for north and northwest flow, and overcast skies. It also weighs first and last light and estimated migration timing for your latitude.",
      light: function (h, c) { return legal(h, c) ? 0.2 + 0.8 * Math.max(g(h, c.sr + 0.3, 0.9), 0.6 * g(h, c.ss - 0.3, 0.9)) : 0.05; },
      pressure: function (x) { var d = x.dp3; if (d >= 0.5) return [1, "Rising behind a front"]; if (Math.abs(d) < 0.5) return [0.55, "Steady"]; return [d < -1.5 ? 0.6 : 0.4, "Falling"]; },
      temp: function (x) { var d = x.dT24; return [d <= -10 ? 1 : d <= -5 ? 0.85 : d <= -2 ? 0.65 : d < 4 ? 0.4 : 0.2, d <= -5 ? "Cold front" : d <= -2 ? "Cooling" : d >= 4 ? "Warming" : "No front"]; },
      wind: function (x) { var v = x.wind, s = v < 5 ? 0.3 : v < 10 ? 0.65 : v <= 25 ? 1 : 0.6; var dir = x.wdir; var nw = dir >= 290 || dir <= 30; if (nw && v >= 8) s = Math.min(1, s + 0.15); return [s, Math.round(v) + " mph " + compass(dir) + (nw && v >= 8 ? ", north flow bonus" : "")]; },
      sky: function (x) { if (x.precip > 0.15) return [0.6, "Heavy precipitation"]; if (x.precip > 0) return [0.85, "Light precipitation"]; return [x.cloud > 70 ? 1 : x.cloud > 35 ? 0.7 : 0.4, x.cloud > 70 ? "Overcast" : x.cloud > 35 ? "Partly cloudy" : "Bluebird sky"]; },
      moon: function (x) { return [x.moon > 0.8 ? 0.4 : 0.8, x.moon > 0.8 ? "Bright moon, more night feeding" : "Dark nights"]; },
      season: function (x) { var d = seasonDist(x.doy, waterPeak(x.lat)); return [d <= 15 ? 1 : d <= 35 ? 0.7 : d <= 60 ? 0.45 : 0.2, d <= 15 ? "Peak migration" : d <= 35 ? "Migration underway" : "Off peak migration"]; }
    },
    turkey: {
      name: "Turkey", w: { light: 40, pressure: 8, temp: 12, wind: 15, sky: 12, moon: 3, season: 10 },
      about: "Spring gobbling is driven by time of day and weather. Fly-down around sunrise scores highest, with a second bump mid-morning. Wind over 10 mph hurts, rain and cold snaps reduce activity, and clear mornings from 50 to 72 degrees score best. Season timing is estimated from latitude.",
      light: function (h, c) { return legal(h, c) ? Math.max(g(h, c.sr + 0.4, 0.8), 0.6 * g(h, c.sr + 4, 1.2), 0.35 * g(h, c.ss - 1, 1.2), 0.2) : 0.05; },
      pressure: function (x) { return Math.abs(x.dp3) < 1 ? [0.9, "Steady"] : x.dp3 > 0 ? [0.75, "Rising"] : [0.4, "Falling"]; },
      temp: function (x) { var t = x.temp; return [t >= 50 && t <= 72 ? 1 : t >= 40 && t <= 80 ? 0.65 : 0.3, t >= 50 && t <= 72 ? "Ideal range" : t < 50 ? "Cool" : "Hot"]; },
      wind: function (x) { var v = x.wind; return [v <= 5 ? 1 : v <= 10 ? 0.75 : v <= 15 ? 0.4 : 0.15, v <= 10 ? "Calm enough to hear gobbles" : "Wind hurts hearing and gobbling"]; },
      sky: function (x) { if (x.precip > 0.05) return [0.2, "Rain"]; if (x.precip > 0) return [0.5, "Drizzle"]; return [x.cloud < 40 ? 1 : 0.75, x.cloud < 40 ? "Clear" : "Cloudy"]; },
      moon: function () { return [0.6, "Minimal effect"]; },
      season: function (x) { var d = seasonDist(x.doy, turkeyPeak(x.lat)); return [d <= 10 ? 1 : d <= 25 ? 0.7 : d <= 45 ? 0.4 : 0.15, d <= 10 ? "Peak gobbling" : d <= 25 ? "Breeding season" : "Outside spring peak"]; }
    },
    elk: {
      name: "Elk", w: { light: 35, pressure: 8, temp: 22, wind: 12, sky: 8, moon: 3, season: 12 },
      about: "Elk are heat sensitive and most active at dawn and dusk. The forecast leans on temperature, wind, light and a rut calendar that peaks in late September. Elevation and terrain change timing, so use the score as a starting point.",
      light: function (h, c) { return legal(h, c) ? 0.08 + 0.92 * Math.max(g(h, c.sr, 1), g(h, c.ss, 1)) : 0.05; },
      pressure: function (x) { return x.dp3 >= 0 ? [0.85, x.dp3 > 0.5 ? "Rising" : "Steady"] : [0.5, "Falling"]; },
      temp: function (x) { var t = x.temp; return [t <= 45 ? 1 : t <= 55 ? 0.8 : t <= 65 ? 0.5 : 0.2, t <= 45 ? "Cool" : t <= 65 ? "Mild" : "Hot, elk bed early"]; },
      wind: function (x) { var v = x.wind; return [v <= 12 ? 1 : v <= 20 ? 0.6 : 0.3, v <= 12 ? "Light" : "Windy"]; },
      sky: function (x) { if (x.precip > 0.1) return [0.4, "Heavy rain or snow"]; if (x.precip > 0) return [0.8, "Light precipitation"]; return [x.cloud > 60 ? 0.85 : 0.75, x.cloud > 60 ? "Overcast" : "Clear"]; },
      moon: function (x) { return [0.5 + 0.5 * (1 - x.moon), "Little effect"]; },
      season: function (x) { var d = seasonDist(x.doy, 271); return [d <= 10 ? 1 : d <= 25 ? 0.7 : d <= 50 ? 0.45 : 0.25, d <= 10 ? "Peak rut" : d <= 25 ? "Rut building or fading" : "Outside the rut"]; }
    },
    upland: {
      name: "Upland", w: { light: 25, pressure: 5, temp: 20, wind: 25, sky: 15, moon: 0, season: 10 },
      about: "This is the least certain model. Wind is the main driver, since past 12 mph birds flush wild and dogs lose scent. Cool temperatures and damp air help dogs and birds. Season windows are rough and vary by state and species.",
      light: function (h, c) { if (!legal(h, c)) return 0.05; if (h < c.sr + 1) return 0.25; return 0.3 + 0.7 * Math.max(g(h, c.sr + 3, 1.5), g(h, c.ss - 2, 1.5)); },
      pressure: function (x) { return Math.abs(x.dp3) < 1 ? [0.8, "Steady"] : [0.6, x.dp3 > 0 ? "Rising" : "Falling"]; },
      temp: function (x) { var t = x.temp; return [t >= 30 && t <= 60 ? 1 : t >= 20 && t <= 70 ? 0.6 : 0.25, t > 60 ? "Warm, hard on dogs" : t < 30 ? "Cold" : "Good dog weather"]; },
      wind: function (x) { var v = x.wind; return [v <= 8 ? 1 : v <= 12 ? 0.75 : v <= 18 ? 0.35 : 0.1, v <= 12 ? "Scent holds" : "Birds flush wild"]; },
      sky: function (x) { if (x.precip > 0.1) return [0.3, "Heavy rain"]; var rh = x.rh; return [rh >= 50 && rh <= 85 ? 1 : rh > 85 ? 0.75 : 0.5, rh < 50 ? "Dry air, poor scent" : "Damp air helps scent"]; },
      moon: function () { return [0.5, "No effect"]; },
      season: function (x) { var d = x.doy; var inS = d >= 274 || d <= 31; return [inS ? 1 : 0.3, inS ? "Typical season window" : "Outside typical seasons"]; }
    }
  };
  var ORDER = ["deer", "waterfowl", "turkey", "elk", "upland"];
  var FNAMES = { light: "Light", pressure: "Pressure", temp: "Temperature", wind: "Wind", sky: "Sky", moon: "Moon", season: "Season" };

  /* ---------- weather ---------- */
  var cache = {};
  function getWeather(loc, day) {
    var start = addDays(day, -1), key = loc.lat.toFixed(3) + "," + loc.lon.toFixed(3) + "," + day;
    if (cache[key]) return cache[key];
    var diff = dayDiff(day, today());
    if (diff > DAYS_AHEAD) return Promise.reject(new Error("Forecasts only run " + DAYS_AHEAD + " days out."));
    var base = diff < -PAST_FC ? ARC : FC;
    var url = base + "?latitude=" + loc.lat + "&longitude=" + loc.lon + "&hourly=" + HOURLY +
      "&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto" +
      "&start_date=" + start + "&end_date=" + day;
    var p = fetch(url).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.reason || "Weather service error (" + r.status + ")."); });
      return r.json();
    });
    cache[key] = p;
    p.catch(function () { delete cache[key]; });
    return p;
  }

  function scoreDay(wx, day, lat, sp) {
    var m = SP[sp], H = wx.hourly, D = wx.daily;
    var di = D.time.indexOf(day); if (di < 0) di = D.time.length - 1;
    var c = { sr: hrOf(D.sunrise[di]), ss: hrOf(D.sunset[di]) };
    var mo = moon(day), dy = doy(day), out = [];
    for (var i = 0; i < H.time.length; i++) {
      if (H.time[i].slice(0, 10) !== day) continue;
      var x = {
        temp: H.temperature_2m[i], rh: H.relative_humidity_2m[i], p: H.pressure_msl[i],
        wind: H.wind_speed_10m[i], wdir: H.wind_direction_10m[i], cloud: H.cloud_cover[i], precip: H.precipitation[i] || 0,
        dp3: i >= 3 && H.pressure_msl[i - 3] != null ? H.pressure_msl[i] - H.pressure_msl[i - 3] : 0,
        dT24: i >= 24 && H.temperature_2m[i - 24] != null ? H.temperature_2m[i] - H.temperature_2m[i - 24] : 0,
        moon: mo.illum, doy: dy, lat: lat
      };
      if (x.temp == null || x.p == null || x.wind == null) continue;
      var hr = hrOf(H.time[i]) + 0.5, f = {}, total = 0;
      Object.keys(m.w).forEach(function (k) {
        var r = k === "light" ? [m.light(hr, c), hr < c.sr - 0.5 || hr > c.ss + 0.5 ? "Outside legal light" : "Hours from sunrise " + hm(c.sr) + " / sunset " + hm(c.ss)] : m[k](x);
        var pts = r[0] * m.w[k]; total += pts;
        f[k] = { v: r[0], pts: pts, max: m.w[k], note: r[1] };
      });
      out.push({ hr: hrOf(H.time[i]), score: Math.round(clamp(total, 0, 100)), legal: legal(hr, c), f: f, x: x });
    }
    return { hours: out, sun: c, moon: mo };
  }

  /* ---------- state ---------- */
  var sp = ORDER.indexOf(PRESET.sp) >= 0 ? PRESET.sp : (ORDER.indexOf(store("ff_sp")) >= 0 ? store("ff_sp") : (PRESET.sp0 || "deer"));
  var loc = null, day = today(), current = null, selHr = null;
  var saved = store("ff_loc");
  if (PRESET.force && PRESET.lat != null) loc = { name: PRESET.name, lat: PRESET.lat, lon: PRESET.lon };
  else if (saved && saved.lat != null) loc = saved;
  else if (PRESET.lat != null) loc = { name: PRESET.name, lat: PRESET.lat, lon: PRESET.lon };

  function msg(t) { $("msg").textContent = t || ""; }

  /* ---------- species chips ---------- */
  function renderChips() {
    $("chips").innerHTML = ORDER.map(function (k) {
      return '<button type="button" data-sp="' + k + '" class="' + (k === sp ? "on" : "") + '" aria-pressed="' + (k === sp) + '">' + SP[k].name + "</button>";
    }).join("");
    $("about").textContent = SP[sp].about;
    $("seenQ").textContent = "Seen any " + SP[sp].name.toLowerCase() + "?";
  }
  $("chips").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-sp]"); if (!b) return;
    sp = b.getAttribute("data-sp"); store("ff_sp", sp);
    renderChips(); renderAff(); rescore(); renderLog(); preview();
  });

  /* ---------- search ---------- */
  function search() {
    var q = $("q").value.trim();
    $("results").innerHTML = "";
    if (q.length < 2) { msg("Type a town or city name."); return; }
    msg("Searching...");
    // Open-Meteo matches on place name only, so search "Town, State" by the first part and filter by the rest.
    var parts = q.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    fetch(GEO + "?name=" + encodeURIComponent(parts[0]) + "&count=10&language=en&format=json")
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (j) {
        var res = j.results || [];
        if (parts.length > 1) {
          var want = parts.slice(1).join(" ").toLowerCase();
          var f = res.filter(function (r) { return [r.admin1, r.country, r.country_code, r.admin2].join(" ").toLowerCase().indexOf(want) >= 0; });
          if (f.length) res = f;
        }
        if (!res.length) { msg("No places found for \"" + q + "\". Try a nearby town or check the spelling."); return; }
        msg("");
        $("results").innerHTML = res.slice(0, 6).map(function (r, i) {
          var sub = [r.admin2, r.admin1, r.country].filter(Boolean).join(", ");
          return '<button type="button" data-i="' + i + '" style="text-align:left">' + esc(r.name) + (sub ? ' <span class="mute">' + esc(sub) + "</span>" : "") + "</button>";
        }).join("");
        $("results").onclick = function (e) {
          var b = e.target.closest("button[data-i]"); if (!b) return;
          var r = res[+b.getAttribute("data-i")];
          setLoc({ name: [r.name, r.admin1 || r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude });
        };
      })
      .catch(function () { msg("Could not reach the location search. Check your connection and try again."); });
  }
  $("s").addEventListener("click", search);
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });

  $("g").addEventListener("click", function () {
    if (!navigator.geolocation) { msg("This browser cannot share its location. Search for a town instead."); return; }
    msg("Finding your location...");
    navigator.geolocation.getCurrentPosition(function (p) {
      var lat = +p.coords.latitude.toFixed(4), lon = +p.coords.longitude.toFixed(4);
      setLoc({ name: "My location (" + lat.toFixed(2) + ", " + lon.toFixed(2) + ")", lat: lat, lon: lon });
    }, function (err) {
      msg(err.code === 1 ? "Location permission was denied. Allow it in your browser settings or search for a town." : "Could not get your location. Search for a town instead.");
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });

  function setLoc(l) {
    loc = l; store("ff_loc", l);
    $("results").innerHTML = ""; $("q").value = ""; msg("");
    load(); renderLog(); preview();
  }

  /* ---------- forecast view ---------- */
  var dateEl = $("date");
  dateEl.min = today(); dateEl.max = addDays(today(), DAYS_AHEAD); dateEl.value = day;
  dateEl.addEventListener("change", function () { if (dateEl.value) { day = dateEl.value; load(); } });

  function load() {
    if (!loc) { msg("Search for a town or tap Use my location to start."); return; }
    dateEl.disabled = false;
    if (dayDiff(day, today()) < 0) { day = today(); dateEl.value = day; }
    msg("Loading forecast for " + loc.name + "...");
    var want = day;
    getWeather(loc, day).then(function (wx) {
      if (want !== day) return;
      current = { wx: wx, day: day }; selHr = null; msg(""); rescore();
    }).catch(function (e) { msg(e.message || "Could not load the forecast. Try again."); });
  }

  function rescore() {
    if (!current) return;
    var r = scoreDay(current.wx, current.day, loc.lat, sp), hrs = r.hours;
    if (!hrs.length) { msg("No weather data for that day."); return; }
    $("out").hidden = false;
    var lh = hrs.filter(function (h) { return h.legal; }); if (!lh.length) lh = hrs;
    var best = lh.reduce(function (a, b) { return b.score > a.score ? b : a; });
    function win(list) {
      var bw = null;
      for (var i = 0; i + 1 < list.length; i++) {
        if (list[i + 1].hr - list[i].hr !== 1) continue;
        var avg = (list[i].score + list[i + 1].score) / 2;
        if (!bw || avg > bw.avg) bw = { a: list[i].hr, b: list[i + 1].hr + 1, avg: avg };
      }
      return bw;
    }
    var am = win(lh.filter(function (h) { return h.hr < 12; })), pm = win(lh.filter(function (h) { return h.hr >= 12; }));
    var temps = hrs.map(function (h) { return h.x.temp; }), winds = hrs.map(function (h) { return h.x.wind; });
    var dp = hrs[hrs.length - 1].x.p - hrs[0].x.p;
    $("sum").innerHTML =
      '<div class="mute">' + esc(loc.name) + " · " + fmtDay(current.day) + " · " + SP[sp].name + "</div>" +
      '<div style="display:flex;align-items:flex-end;gap:14px;margin:6px 0 10px"><div class="big" style="color:' + color(best.score) + '">' + best.score + '</div><div><div class="lbl">' + label(best.score) + '</div><div class="mute">Peak at ' + hm(best.hr) + "</div></div></div>" +
      (am ? '<div class="win"><span>Best morning</span><span>' + hm(am.a) + " to " + hm(am.b) + " · " + Math.round(am.avg) + "</span></div>" : "") +
      (pm ? '<div class="win"><span>Best evening</span><span>' + hm(pm.a) + " to " + hm(pm.b) + " · " + Math.round(pm.avg) + "</span></div>" : "") +
      '<div class="win"><span>Temperature</span><span>' + Math.round(Math.min.apply(null, temps)) + "° to " + Math.round(Math.max.apply(null, temps)) + "°F</span></div>" +
      '<div class="win"><span>Wind</span><span>up to ' + Math.round(Math.max.apply(null, winds)) + " mph</span></div>" +
      '<div class="win"><span>Pressure</span><span>' + (Math.abs(dp) < 1 ? "Steady" : dp > 0 ? "Rising" : "Falling") + " (" + (dp > 0 ? "+" : "") + dp.toFixed(1) + " hPa)</span></div>" +
      '<div class="win"><span>Sun</span><span>' + hm(r.sun.sr) + " to " + hm(r.sun.ss) + "</span></div>" +
      '<div class="win"><span>Moon</span><span>' + r.moon.name + " · " + Math.round(r.moon.illum * 100) + "% lit</span></div>";
    $("chartT").textContent = "Hourly score. Tap an hour for details. Dim bars are outside legal light.";
    chart(hrs);
    detail(hrs, selHr != null ? selHr : best.hr);
  }

  function chart(hrs) {
    var W = 480, Ht = 150, bw = W / 24, svg = '<svg viewBox="0 0 ' + W + " " + (Ht + 20) + '" role="img" aria-label="Hourly scores">';
    hrs.forEach(function (h) {
      var x = h.hr * bw, bh = Math.max(2, h.score / 100 * Ht);
      svg += '<g data-hr="' + h.hr + '" style="cursor:pointer"><rect x="' + x + '" y="0" width="' + bw + '" height="' + Ht + '" fill="transparent"/>' +
        '<rect x="' + (x + 1.5) + '" y="' + (Ht - bh) + '" width="' + (bw - 3) + '" height="' + bh + '" rx="2" fill="' + color(h.score) + '" opacity="' + (h.legal ? 1 : 0.3) + '"' + (h.hr === selHr ? ' stroke="currentColor" stroke-width="1.5"' : "") + "><title>" + hm(h.hr) + ": " + h.score + "</title></rect></g>";
    });
    for (var t = 0; t < 24; t += 3) svg += '<text x="' + (t * bw + bw / 2) + '" y="' + (Ht + 15) + '" font-size="11" text-anchor="middle" fill="currentColor" opacity="0.6">' + (t === 0 ? "12a" : t < 12 ? t + "a" : t === 12 ? "12p" : (t - 12) + "p") + "</text>";
    $("chart").innerHTML = svg + "</svg>";
  }
  $("chart").addEventListener("click", function (e) {
    var gEl = e.target.closest("[data-hr]"); if (!gEl) return;
    selHr = +gEl.getAttribute("data-hr"); rescore();
  });

  function detail(hrs, hr) {
    var h = hrs.filter(function (x) { return x.hr === hr; })[0] || hrs[0];
    var x = h.x;
    $("detail").innerHTML = '<div class="lbl">' + hm(h.hr) + ": " + h.score + " · " + label(h.score) + "</div>" +
      '<div class="mute" style="margin-bottom:6px">' + Math.round(x.temp) + "°F · wind " + Math.round(x.wind) + " mph " + compass(x.wdir) + " · " + Math.round(x.cloud) + "% cloud · " + x.p.toFixed(0) + " hPa" + (x.precip ? " · " + x.precip.toFixed(2) + " in rain" : "") + "</div>" +
      Object.keys(h.f).filter(function (k) { return h.f[k].max > 0; }).map(function (k) {
        var f = h.f[k];
        return '<div class="f"><span>' + FNAMES[k] + '</span><div class="bar"><i style="width:' + Math.round(f.v * 100) + "%;background:" + color(f.v * 100) + '"></i></div><span class="pts">' + Math.round(f.pts) + "/" + f.max + "</span><small>" + esc(f.note) + "</small></div>";
      }).join("");
  }

  /* ---------- tabs ---------- */
  function tab(n) { $("t1").className = n === 1 ? "on" : ""; $("t2").className = n === 2 ? "on" : ""; $("v1").hidden = n !== 1; $("v2").hidden = n !== 2; if (n === 2) { renderLog(); preview(); } }
  $("t1").addEventListener("click", function () { tab(1); });
  $("t2").addEventListener("click", function () { tab(2); });

  /* ---------- hunt log ---------- */
  var LOGK = "ff_log", editId = null, editLoc = null, seen = null, pvData = null;
  function logs() { return store(LOGK) || []; }
  function saveLogs(a) { store(LOGK, a); }
  $("ld").value = today();
  $("ld").max = addDays(today(), DAYS_AHEAD);
  function logLoc() { return editLoc || loc; }

  function setSeen(v) {
    seen = v;
    $("yes").className = v === true ? "on" : ""; $("no").className = v === false ? "on" : "";
    $("sights").hidden = v !== true;
    if (v === true && !$("srows").children.length) addSight();
  }
  $("yes").addEventListener("click", function () { setSeen(true); });
  $("no").addEventListener("click", function () { setSeen(false); });

  function addSight(t, n) {
    var d = document.createElement("div");
    d.className = "row"; d.style.marginBottom = "6px";
    d.innerHTML = '<input type="time" aria-label="Sighting time" style="flex:2"><input type="number" min="1" max="999" inputmode="numeric" placeholder="How many" aria-label="How many" style="flex:1"><button type="button" aria-label="Remove sighting">✕</button>';
    d.children[0].value = t || $("ls").value || "";
    d.children[1].value = n || 1;
    d.children[2].onclick = function () { d.remove(); };
    $("srows").appendChild(d);
  }
  $("addS").addEventListener("click", function () { addSight(); });

  function windowStats(hrs, s, e) {
    var a = Math.floor(toH(s)), b = Math.ceil(toH(e)); if (b <= a) b = a + 1;
    var w = hrs.filter(function (h) { return h.hr >= a && h.hr < b; });
    if (!w.length) return null;
    var avg = w.reduce(function (t, h) { return t + h.score; }, 0) / w.length;
    var pk = w.reduce(function (m, h) { return h.score > m.score ? h : m; });
    return { avg: Math.round(avg), peak: pk.score, peakHr: pk.hr, temp: Math.round(w[0].x.temp), wind: Math.round(w[0].x.wind), wdir: compass(w[0].x.wdir), pressure: Math.round(w[0].x.p), dp3: +w[0].x.dp3.toFixed(1) };
  }

  function preview() {
    var L = logLoc(), d = $("ld").value;
    $("lloc").textContent = L ? "Logging " + SP[sp].name.toLowerCase() + " hunts at " + L.name : "Pick a location above to start logging hunts.";
    pvData = null;
    if (!L || !d) { $("pv").innerHTML = ""; return; }
    $("pv").innerHTML = '<span class="mute">Loading weather for ' + fmtDay(d) + "...</span>";
    var want = d + sp;
    getWeather(L, d).then(function (wx) {
      if (want !== $("ld").value + sp) return;
      var r = scoreDay(wx, d, L.lat, sp), st = windowStats(r.hours, $("ls").value, $("le").value);
      pvData = { hours: r.hours.map(function (h) { return h.score; }), stats: st, moon: r.moon.name };
      $("pv").innerHTML = st ? '<div class="win"><span>Forecast during hunt</span><span><b style="color:' + color(st.avg) + '">' + st.avg + "</b> avg · peak " + st.peak + " at " + hm(st.peakHr) + '</span></div><div class="mute">' + st.temp + "°F · " + st.wind + " mph " + st.wdir + " · " + st.pressure + " hPa · " + r.moon.name + "</div>" : '<span class="mute">No weather for those hours.</span>';
    }).catch(function (e) { $("pv").innerHTML = '<span class="mute">' + esc(e.message || "Weather unavailable for that day.") + " You can still save the hunt.</span>"; });
  }
  ["ld", "ls", "le"].forEach(function (id) { $(id).addEventListener("change", preview); });

  function resetForm() {
    editId = null; editLoc = null;
    $("ld").value = today(); $("ls").value = "06:00"; $("le").value = "09:00";
    $("lh").value = ""; $("ln").value = ""; $("srows").innerHTML = ""; setSeen(null);
    $("cancel").hidden = true; $("save").textContent = "Save hunt";
  }
  $("cancel").addEventListener("click", function () { resetForm(); preview(); $("lmsg").textContent = ""; });

  $("save").addEventListener("click", function () {
    var L = logLoc();
    if (!L) { $("lmsg").textContent = "Pick a location first."; return; }
    if (!$("ld").value) { $("lmsg").textContent = "Pick the day you hunted."; return; }
    if (seen === null) { $("lmsg").textContent = "Choose Yes or No for whether you saw anything."; return; }
    var sights = seen ? [].map.call($("srows").children, function (r) { return { t: r.children[0].value, n: +r.children[1].value || 1 }; }).filter(function (s) { return s.t; }) : [];
    var a = logs(), prev = editId ? a.filter(function (x) { return x.id === editId; })[0] : null;
    var e = {
      id: editId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sp: prev ? prev.sp : sp, loc: L, day: $("ld").value, start: $("ls").value, end: $("le").value,
      seen: seen, sightings: sights, harvest: $("lh").value === "" ? null : +$("lh").value, notes: $("ln").value.trim(),
      fc: pvData && pvData.stats ? pvData.stats : (prev ? prev.fc : null), hours: pvData ? pvData.hours : (prev ? prev.hours : null),
      moon: pvData ? pvData.moon : (prev ? prev.moon : null), saved: new Date().toISOString()
    };
    a = a.filter(function (x) { return x.id !== e.id; }); a.push(e); saveLogs(a);
    $("lmsg").textContent = editId ? "Hunt updated." : "Hunt saved.";
    resetForm(); renderLog(); preview();
  });

  function renderLog() {
    var all = logs(), a = all.filter(function (x) { return x.sp === sp; }).sort(function (x, y) { return y.day < x.day ? -1 : y.day > x.day ? 1 : (y.start < x.start ? -1 : 1); });
    $("exp").hidden = !all.length;
    $("list").innerHTML = a.length ? a.map(function (e) {
      var s = e.seen ? (e.sightings && e.sightings.length ? "Seen: " + e.sightings.map(function (x) { return x.n + " at " + hm(toH(x.t)); }).join(", ") : "Seen") : "Nothing seen";
      return '<div class="panel"><div style="display:flex;justify-content:space-between;gap:10px"><b>' + fmtDay(e.day) + "</b>" + (e.fc ? '<span style="color:' + color(e.fc.avg) + '"><b>' + e.fc.avg + "</b> forecast</span>" : "") + "</div>" +
        '<div class="mute">' + esc(e.loc && e.loc.name) + " · " + hm(toH(e.start)) + " to " + hm(toH(e.end)) + (e.fc ? " · " + e.fc.temp + "°F, " + e.fc.wind + " mph " + e.fc.wdir : "") + "</div>" +
        "<div>" + esc(s) + (e.harvest ? " · Harvested " + e.harvest : "") + "</div>" +
        (e.notes ? '<div class="note">' + esc(e.notes) + "</div>" : "") +
        '<div class="row" style="margin-top:6px"><button type="button" data-ed="' + e.id + '">Edit</button><button type="button" data-del="' + e.id + '">Delete</button></div></div>';
    }).join("") : '<p class="mute">No ' + SP[sp].name.toLowerCase() + " hunts logged yet.</p>";
    insights(a);
  }

  function insights(a) {
    var withFc = a.filter(function (e) { return e.fc; });
    if (a.length < 3) { $("ins").hidden = true; return; }
    var yes = withFc.filter(function (e) { return e.seen; }), no = withFc.filter(function (e) { return !e.seen; });
    function avg(l) { return l.length ? Math.round(l.reduce(function (t, e) { return t + e.fc.avg; }, 0) / l.length) : null; }
    var rate = Math.round(a.filter(function (e) { return e.seen; }).length / a.length * 100);
    $("ins").hidden = false;
    $("ins").innerHTML = '<div class="lbl">Your ' + SP[sp].name.toLowerCase() + " log</div>" +
      '<div class="win"><span>Hunts logged</span><span>' + a.length + "</span></div>" +
      '<div class="win"><span>Hunts with sightings</span><span>' + rate + "%</span></div>" +
      (avg(yes) != null ? '<div class="win"><span>Avg forecast when seen</span><span>' + avg(yes) + "</span></div>" : "") +
      (avg(no) != null ? '<div class="win"><span>Avg forecast when not seen</span><span>' + avg(no) + "</span></div>" : "") +
      '<div class="mute">A handful of hunts is not enough to judge the score. Keep logging.</div>';
  }

  $("list").addEventListener("click", function (ev) {
    var b = ev.target.closest("button"); if (!b) return;
    var id = b.getAttribute("data-ed") || b.getAttribute("data-del");
    var a = logs(), e = a.filter(function (x) { return x.id === id; })[0]; if (!e) return;
    if (b.hasAttribute("data-del")) {
      if (!confirm("Delete the hunt on " + fmtDay(e.day) + "?")) return;
      saveLogs(a.filter(function (x) { return x.id !== id; }));
      if (editId === id) resetForm();
      renderLog(); return;
    }
    editId = id; editLoc = e.loc;
    $("ld").value = e.day; $("ls").value = e.start; $("le").value = e.end;
    $("lh").value = e.harvest == null ? "" : e.harvest; $("ln").value = e.notes || "";
    $("srows").innerHTML = ""; (e.sightings || []).forEach(function (s) { addSight(s.t, s.n); }); setSeen(e.seen);
    $("cancel").hidden = false; $("save").textContent = "Update hunt"; $("lmsg").textContent = "Editing the hunt on " + fmtDay(e.day) + ".";
    preview(); $("v2").scrollIntoView({ behavior: "smooth" });
  });

  $("exp").addEventListener("click", function () {
    var cols = ["species", "day", "location", "lat", "lon", "start", "end", "seen", "sightings", "harvested", "forecast_avg", "forecast_peak", "temp_f", "wind_mph", "wind_dir", "pressure_hpa", "pressure_3h_change", "moon", "notes"];
    var rows = logs().sort(function (x, y) { return x.day < y.day ? -1 : 1; }).map(function (e) {
      var f = e.fc || {};
      return [e.sp, e.day, e.loc && e.loc.name, e.loc && e.loc.lat, e.loc && e.loc.lon, e.start, e.end, e.seen ? "yes" : "no",
        (e.sightings || []).map(function (s) { return s.t + " x" + s.n; }).join("; "), e.harvest, f.avg, f.peak, f.temp, f.wind, f.wdir, f.pressure, f.dp3, e.moon, e.notes];
    });
    var csv = [cols].concat(rows).map(function (r) { return r.map(function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "hunt-log-" + today() + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ---------- affiliate links, donate, ads ---------- */
  function renderAff() {
    var l = (CFG.AFFILIATE || {})[sp] || [];
    $("aff").hidden = !l.length;
    $("aff").innerHTML = l.length ? '<div class="lbl">' + SP[sp].name + ' gear</div><p class="mute">Affiliate links. The site may earn a commission at no extra cost to you.</p><div class="aff">' +
      l.map(function (x) { return '<a href="' + esc(x.url) + '" target="_blank" rel="sponsored noopener"><b>' + esc(x.name) + "</b>" + (x.note ? " " + esc(x.note) : "") + "</a>"; }).join("") + "</div>" : "";
  }
  if (CFG.DONATE_URL) { $("donate").href = CFG.DONATE_URL; $("donate").hidden = false; }

  function loadAds() {
    if (!CFG.ADSENSE_CLIENT) return;
    var s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(CFG.ADSENSE_CLIENT);
    document.head.appendChild(s);
    [].forEach.call(document.querySelectorAll(".ad[data-slot]"), function (el) {
      var slot = (CFG.AD_SLOTS || {})[el.getAttribute("data-slot")]; if (!slot) return;
      el.innerHTML = '<small>Advertisement</small><ins class="adsbygoogle" style="display:block" data-ad-client="' + esc(CFG.ADSENSE_CLIENT) + '" data-ad-slot="' + esc(slot) + '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
      el.hidden = false;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }
  if (CFG.ADSENSE_CLIENT) {
    var c = store("ff_consent");
    if (c === "yes") loadAds();
    else if (c !== "no") $("consent").hidden = false;
  }
  $("cOk").addEventListener("click", function () { store("ff_consent", "yes"); $("consent").hidden = true; loadAds(); });
  $("cNo").addEventListener("click", function () { store("ff_consent", "no"); $("consent").hidden = true; });

  /* ---------- start ---------- */
  renderChips(); renderAff(); resetForm(); renderLog();
  if (loc) { load(); preview(); } else msg("Search for a town or tap Use my location to start.");
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});
})();
