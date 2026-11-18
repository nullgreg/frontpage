// Stand-ins for the extension APIs and the weather service, so the page can be
// rendered in headless Firefox. dev/serve.py loads this before app.js; it is
// never part of the extension. Everything is driven by URL parameters:
//
//   bg=ID        background style                    (aurora)
//   still        Animate background off              (animated)
//   fx=0         Weather effects off                 (on)
//   nocity       no weather city set                 (city "Testville")
//   wx=KIND      clear|partly|overcast|fog|drizzle|rain|snow|storm  (clear)
//   code=N       explicit WMO code, overrides wx
//   wind=N       wind, km/h                          (12)
//   cloud=N      cloud cover, 0..100                 (5 clear, 45 partly, 95 otherwise)
//   sun=P        fraction of daylight elapsed: 0.5 midday, 1.4 night, -0.2 pre-dawn (0.5)
//   name=TEXT    who jokes are addressed to
//   nojokes      hide jokes
//   forecast     show the 7-day forecast list
//   photos=IDS   Photos style with these categories, comma-separated (bg=photos)
//   refresh=ID   how often Photos changes: tab|15m|hour|day  (day)
//   livephotos   let Photos reach the real Commons and Art Institute APIs
//                (otherwise both answer with the pictures in dev/fixtures/)
//   icons        site icons on (makes network requests)
//   settings     open the settings dialog
//   notes        open the notes panel
//   q=TEXT       text typed into the search box
//   wait=N       seconds before the screenshot      (4)
//   warnings     show console.warn messages in the error box too
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const has = (name) => params.has(name);
  const num = (name, fallback) => {
    const value = parseFloat(params.get(name));
    return Number.isFinite(value) ? value : fallback;
  };

  // ----- errors, made visible -----
  let box = null;
  function showError(text) {
    if (!box) {
      box = document.createElement("pre");
      box.id = "dev-errors";
      box.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:9999;margin:0;padding:8px 12px;" +
        "background:#b3001b;color:#fff;font:13px/1.4 monospace;white-space:pre-wrap";
      (document.body ?? document.documentElement).prepend(box);
    }
    box.textContent += (box.textContent ? "\n" : "") + text;
  }
  window.addEventListener("error", (event) => {
    showError(`Error: ${event.message} (${event.filename}:${event.lineno})`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    showError(`Unhandled rejection: ${event.reason?.stack ?? event.reason}`);
  });
  if (has("warnings")) {
    const warn = console.warn.bind(console);
    console.warn = (...args) => {
      warn(...args);
      showError(`Warning: ${args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" ")}`);
    };
  }

  // ----- weather scenario -----
  const WX_CODES = { clear: 0, partly: 2, overcast: 3, fog: 45, drizzle: 53, rain: 63, snow: 73, storm: 95 };
  const wx = params.get("wx") ?? "clear";
  if (!(wx in WX_CODES)) showError(`Shim: unknown wx "${wx}"; using clear`);
  const code = has("code") ? num("code", 0) : (WX_CODES[wx] ?? 0);
  const kind = code <= 1 ? "clear" : code === 2 ? "partly" : "other";
  const cloud = num("cloud", { clear: 5, partly: 45, other: 95 }[kind]);
  const wind = num("wind", 12);
  const sun = num("sun", 0.5);
  const precipitation =
    code >= 95 ? 3.2 : code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82 ? 0.9
    : code >= 61 ? 1.6 : code >= 51 ? 0.3 : 0;

  const CITY = { name: "Testville", region: "Testshire, Testland", latitude: 51.5, longitude: -0.12 };

  /** A forecast response shaped like the real one (plan, section 4). */
  function forecast(url) {
    const fahrenheit = url.searchParams.get("temperature_unit") === "fahrenheit";
    const temp = (celsius) => (fahrenheit ? Math.round(celsius * 1.8 + 32) : celsius);
    const now = Math.floor(Date.now() / 1000);
    const sunrise = Math.round(now - sun * 12 * 3600);
    // Local midnights for today and the next six days, and a varied week.
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const days = [0, 1, 2, 3, 4, 5, 6];
    const time = days.map((i) => Math.floor(new Date(midnight).setDate(midnight.getDate() + i) / 1000));
    const codes = [code, 61, 3, 2, 0, 80, 71];
    const highs = [22.3, 17.8, 15.2, 16.9, 19.4, 14.1, 4.6];
    const lows = [11.2, 9.6, 8.1, 7.4, 8.8, 6.0, -1.3];
    const rain = [precipitation ? 70 : 5, 85, 20, 10, 0, 60, 75];
    return {
      latitude: CITY.latitude,
      longitude: CITY.longitude,
      generationtime_ms: 0.2,
      utc_offset_seconds: -new Date().getTimezoneOffset() * 60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezone_abbreviation: "TST",
      elevation: 12,
      current_units: {
        time: "unixtime",
        interval: "seconds",
        temperature_2m: fahrenheit ? "°F" : "°C",
        apparent_temperature: fahrenheit ? "°F" : "°C",
        weather_code: "wmo code",
        is_day: "",
        wind_speed_10m: "km/h",
        cloud_cover: "%",
        precipitation: "mm",
      },
      current: {
        time: now - (now % 900),
        interval: 900,
        temperature_2m: temp(18.4),
        apparent_temperature: temp(17.1),
        weather_code: code,
        is_day: sun >= 0 && sun <= 1 ? 1 : 0,
        wind_speed_10m: wind,
        cloud_cover: Math.round(Math.min(100, Math.max(0, cloud))),
        precipitation,
      },
      daily_units: {
        time: "unixtime",
        weather_code: "wmo code",
        temperature_2m_max: fahrenheit ? "°F" : "°C",
        temperature_2m_min: fahrenheit ? "°F" : "°C",
        precipitation_probability_max: "%",
        sunrise: "unixtime",
        sunset: "unixtime",
      },
      daily: {
        time,
        weather_code: codes,
        temperature_2m_max: highs.map(temp),
        temperature_2m_min: lows.map(temp),
        precipitation_probability_max: rain,
        sunrise: days.map((i) => sunrise + i * 86400),
        sunset: days.map((i) => sunrise + 12 * 3600 + i * 86400),
      },
    };
  }

  // ----- picture services -----
  // Three stand-in pictures, served by dev/serve.py, answered in the shape of
  // a Commons search and an Art Institute search.
  const FIXTURES = [
    { name: "photo-1", title: "Hills at dusk", artist: '<a href="https://example.com/">Dev Shim</a>' },
    { name: "photo-2", title: "A bright sea", artist: "<div class=\"fn value\">Dev &amp; Shim</div>" },
    { name: "photo-3", title: "Nebula", artist: "NASA/ESA" },
  ];
  const fixtureUrl = (name) => `${location.origin}/dev/fixtures/${name}.svg`;

  function commonsSearch() {
    return {
      batchcomplete: true,
      query: {
        pages: FIXTURES.map(({ name, title, artist }, i) => ({
          pageid: 9000 + i,
          ns: 6,
          title: `File:${title}.jpg`,
          imageinfo: [
            {
              width: 3000,
              height: 2000,
              mime: "image/jpeg",
              url: fixtureUrl(name),
              thumburl: fixtureUrl(name),
              descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`,
              extmetadata: {
                ObjectName: { value: title },
                Artist: { value: artist },
                LicenseShortName: { value: "CC BY-SA 4.0" },
              },
            },
          ],
        })),
      },
    };
  }

  function aicSearch() {
    return {
      pagination: { total: FIXTURES.length, limit: 100, offset: 0, total_pages: 1, current_page: 1 },
      data: FIXTURES.map(({ name, title }, i) => ({
        id: 900 + i,
        title: `${title} (print)`,
        artist_title: "Dev Shim",
        date_display: "1830",
        image_id: name,
        thumbnail: { width: 3000, height: 2000 },
      })),
      config: { iiif_url: `${location.origin}/dev/iiif`, website_url: "https://www.artic.edu" },
    };
  }

  const json = (body) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.open-meteo.com/v1/forecast")) return json(forecast(new URL(url)));
    if (!has("livephotos")) {
      if (url.startsWith("https://commons.wikimedia.org/w/api.php")) return json(commonsSearch());
      if (url.startsWith("https://api.artic.edu/")) return json(aicSearch());
    }
    return realFetch(input, init);
  };

  // ----- bookmarks -----
  let nextId = 100;
  const bookmark = (title, url) => ({ id: String((nextId += 1)), type: "bookmark", title, url });
  const folder = (title, children) => ({ id: String((nextId += 1)), type: "folder", title, children });
  const separator = () => ({ id: String((nextId += 1)), type: "separator", title: "", url: "data:" });

  const TOOLBAR = {
    id: "toolbar_____",
    title: "Bookmarks Toolbar",
    type: "folder",
    children: [
      bookmark("Hacker News", "https://news.ycombinator.com/"),
      bookmark("Wikipedia", "https://en.wikipedia.org/"),
      folder("Work", [
        bookmark("Mail", "https://mail.proton.me/"),
        bookmark("Calendar", "https://calendar.google.com/"),
        bookmark("Tickets", "https://linear.app/"),
        bookmark("Team wiki", "https://www.notion.so/"),
        folder("Infra", [
          bookmark("Grafana", "https://grafana.com/"),
          bookmark("Status page", "https://www.githubstatus.com/"),
          bookmark("Cloud console", "https://console.cloud.google.com/"),
        ]),
      ]),
      folder("Reading", [
        bookmark("Lobsters", "https://lobste.rs/"),
        bookmark("Ars Technica", "https://arstechnica.com/"),
        bookmark(
          "An extremely long bookmark title that goes on and on, to check that card rows truncate instead of wrapping or overflowing the card",
          "https://example.com/very/long/title",
        ),
        bookmark("The Guardian", "https://www.theguardian.com/"),
        bookmark("Quanta Magazine", "https://www.quantamagazine.org/"),
        bookmark("LWN", "https://lwn.net/"),
      ]),
      folder("Dev", [
        bookmark("MDN", "https://developer.mozilla.org/"),
        bookmark("GitHub", "https://github.com/"),
        bookmark("Can I use", "https://caniuse.com/"),
        bookmark("Node docs", "https://nodejs.org/docs/latest/api/"),
        bookmark("Toggle dark mode", "javascript:document.body.classList.toggle('dark')"),
      ]),
      separator(),
      folder("Shopping", [
        bookmark("Amazon", "https://www.amazon.com/"),
        bookmark("eBay", "https://www.ebay.com/"),
        bookmark("Etsy", "https://www.etsy.com/"),
      ]),
      folder("Media", [
        bookmark("YouTube", "https://www.youtube.com/"),
        bookmark("Bandcamp", "https://bandcamp.com/"),
        bookmark("Internet Archive", "https://archive.org/"),
        bookmark("BBC", "https://www.bbc.co.uk/"),
      ]),
      folder("Empty folder", []),
    ],
  };

  const noListeners = { addListener() {} };

  // ----- storage -----
  function area(seed = {}) {
    const items = new Map(Object.entries(seed));
    const keysOf = (key) =>
      key == null ? [...items.keys()] : Array.isArray(key) ? key : typeof key === "object" ? Object.keys(key) : [key];
    return {
      async get(key) {
        const out = {};
        for (const name of keysOf(key)) if (items.has(name)) out[name] = structuredClone(items.get(name));
        return out;
      },
      async set(object) {
        for (const [name, value] of Object.entries(object)) items.set(name, structuredClone(value));
      },
      async remove(key) {
        for (const name of keysOf(key)) items.delete(name);
      },
    };
  }

  const settings = {
    city: has("nocity") ? null : CITY,
    unit: "celsius",
    clock: "auto",
    engine: "duckduckgo",
    favicons: has("icons"),
    jokes: !has("nojokes"),
    nerdy: false,
    name: params.get("name") ?? "",
    background: params.get("bg") ?? (has("photos") ? "photos" : "aurora"),
    animate: !has("still"),
    weatherFx: params.get("fx") !== "0",
    forecast: has("forecast"),
    ...(has("photos") && params.get("photos") ? { photoCategories: params.get("photos").split(",") } : {}),
    ...(has("refresh") ? { photoRefresh: params.get("refresh") } : {}),
    updatedAt: 1,
  };

  globalThis.browser = {
    bookmarks: {
      getSubTree: async () => [structuredClone(TOOLBAR)],
      onCreated: noListeners,
      onRemoved: noListeners,
      onChanged: noListeners,
      onMoved: noListeners,
    },
    storage: {
      local: area(),
      sync: area({ settings }),
      onChanged: noListeners,
    },
  };

  // ----- hold the load event -----
  // Headless Firefox screenshots at `load`; a pending image keeps it waiting.
  const wait = Math.max(0, num("wait", 4));
  document.write(`<img src="/slow?s=${wait}" alt="" hidden>`);

  // ----- open things once the page has wired itself up -----
  document.addEventListener("DOMContentLoaded", () => {
    const $ = (id) => document.getElementById(id);
    const q = params.get("q");
    if (q) $("search").value = q;

    // Settings populate the swatches; apply() shows the chip. Both mean the
    // module has run far enough for the buttons to have their listeners.
    const ready = () => $("bg-picker").children.length > 0 && !$("weather").hidden;
    const started = performance.now();
    const timer = setInterval(() => {
      if (!ready()) {
        if (performance.now() - started > 15000) {
          clearInterval(timer);
          showError("Shim: the page did not finish initialising");
        }
        return;
      }
      clearInterval(timer);
      if (has("settings")) $("settings-toggle").click();
      if (has("notes")) $("notes-toggle").click();
      if (q) $("search").dispatchEvent(new Event("input", { bubbles: true }));
    }, 50);
  });
})();
