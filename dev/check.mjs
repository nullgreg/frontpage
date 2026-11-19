// Checks for the pure functions in extension/page/ and dev/safari.mjs. Run: node dev/check.mjs
// Exit code is non-zero on any failure.
//
// Node prints a "Reparsing as ES module" warning when importing the extension's
// files, because package.json has no "type" field. That is expected; leave it.
import assert from "node:assert/strict";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error.message.split("\n").join("\n  ")}`);
  }
}

const page = (file) => import(new URL(`../extension/page/${file}`, import.meta.url));

// ----- phase 0: the harness itself -----
const weather = await page("weather.js");
check("weather.js imports under Node", () => assert.equal(typeof weather.findCities, "function"));

// ----- forecastDays -----
{
  const { forecastDays } = weather;
  const DAY = 86400000;
  // A city at UTC+10; its Friday 14 Nov 2025 starts at 2025-11-13T14:00Z.
  const friday = Date.UTC(2025, 10, 14);
  const data = {
    offset: 10 * 3600 * 1000,
    days: Array.from({ length: 7 }, (_, i) => ({ date: friday + i * DAY, code: 0, high: 20, low: 10 })),
  };
  check("forecastDays labels today by the city's date, not the machine's", () => {
    const days = forecastDays(data, Date.UTC(2025, 10, 13, 15), "en-US"); // already Friday there
    assert.equal(days.length, 7);
    assert.deepEqual(days.slice(0, 3).map((d) => d.label), ["Today", "Sat", "Sun"]);
    assert.equal(days[1].name, "Saturday");
  });
  check("forecastDays drops days that have passed", () => {
    const days = forecastDays(data, Date.UTC(2025, 10, 15, 15), "en-US"); // Sunday there
    assert.equal(days.length, 5);
    assert.equal(days[0].label, "Today");
    assert.equal(days[1].label, "Mon");
  });
  check("forecastDays copes with readings that have no days", () => {
    assert.deepEqual(forecastDays({}), []);
    assert.deepEqual(forecastDays(null), []);
  });
  check("forecastDays marks only today", () => {
    const days = forecastDays(data, Date.UTC(2025, 10, 13, 15), "en-US");
    assert.deepEqual(days.map((d) => d.today), [true, false, false, false, false, false, false]);
  });
  // Berlin, fetched on Thu 26 Mar 2026 (UTC+1). From Sun 29 Mar the local
  // midnights are at UTC+2, so with today's offset those dates land at 23:00
  // the day before.
  const HOUR = 3600 * 1000;
  const thursday = Date.UTC(2026, 2, 26);
  const springForward = {
    offset: HOUR,
    days: Array.from({ length: 7 }, (_, i) => ({ date: thursday + i * DAY - (i >= 3 ? HOUR : 0), code: 0 })),
  };
  check("forecastDays keeps weekdays right across a DST change", () => {
    const days = forecastDays(springForward, Date.UTC(2026, 2, 26, 12), "en-US");
    assert.deepEqual(days.map((d) => d.label), ["Today", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]);
  });
  // Fall-back day fetched while still on summer time: today's midnight lands an hour early.
  const fallBack = { offset: 2 * HOUR, days: [{ date: Date.UTC(2026, 9, 25) - HOUR, code: 0 }] };
  check("forecastDays keeps today on the day clocks go back", () => {
    const days = forecastDays(fallBack, Date.UTC(2026, 9, 25, 0, 30), "en-US");
    assert.deepEqual(days.map((d) => d.label), ["Today"]);
  });
}

// ----- forecast bars -----
{
  const { weekScale, barSpan } = weather;
  const week = [{ low: 10, high: 20 }, { low: 0, high: 12 }, { low: 15, high: 15 }, { low: null, high: null }];
  const scale = weekScale(week);
  check("weekScale places temperatures between the week's lowest low and highest high", () => {
    assert.equal(scale.at(0), 0);
    assert.equal(scale.at(20), 100);
    assert.equal(scale.at(5), 25);
    assert.equal(scale.at(-8), 0); // clamped: the reading now can be outside the forecast
    assert.equal(scale.at(31), 100);
    assert.equal(scale.at(null), null);
    assert.equal(scale.at(undefined), null);
  });
  check("barSpan gives each day's stretch of the track", () => {
    assert.deepEqual(barSpan(scale, week[0]), [50, 100]);
    assert.deepEqual(barSpan(scale, week[1]), [0, 60]);
    assert.equal(barSpan(scale, week[3]), null);
  });
  check("barSpan keeps a bar visible when high and low coincide", () => {
    assert.deepEqual(barSpan(scale, week[2]), [71, 79]);
    assert.deepEqual(barSpan(scale, { low: 20, high: 20 }), [92, 100]);
    assert.deepEqual(barSpan(scale, { low: 0, high: 0 }), [0, 8]);
  });
  check("weekScale copes with no temperatures, and with a single flat day", () => {
    assert.equal(weekScale([]), null);
    assert.equal(weekScale([{ low: null, high: undefined }]), null);
    assert.equal(barSpan(null, { low: 1, high: 2 }), null);
    const flat = weekScale([{ low: 7, high: 7 }]);
    assert.deepEqual(barSpan(flat, { low: 7, high: 7 }), [0, 8]);
  });
  check("weekScale colours by actual temperature, in either unit", () => {
    // 0..20 °C: the 7 °C stop sits 35% along, the 17 °C stop 85%.
    assert.match(scale.gradient, /^linear-gradient\(90deg, /);
    assert.match(scale.gradient, /#86d8e0 35\.0%/);
    assert.match(scale.gradient, /#ffd98a 85\.0%/);
    // The same week in Fahrenheit (32..68) puts the stops in the same places.
    const f = weekScale([{ low: 32, high: 68 }], "fahrenheit");
    assert.match(f.gradient, /#86d8e0 35\.0%/);
    assert.match(f.gradient, /#ffd98a 85\.0%/);
  });
}

// ----- phase 1: toConditions -----
{
  const { toConditions } = weather;
  const now = Date.now();
  const reading = (code, extra = {}) => ({ code, isDay: true, wind: 20, cloud: 60, sunrise: 1, sunset: 2, ...extra });

  // One code from every row of the table in plan section 5.1.
  const TABLE = [
    [0, "clear", 0], [1, "clear", 0], [2, "partly", 0], [3, "overcast", 0], [45, "fog", 0], [48, "fog", 0],
    [51, "drizzle", 0.35], [56, "drizzle", 0.35], [53, "drizzle", 0.65], [55, "drizzle", 1], [57, "drizzle", 1],
    [61, "rain", 0.35], [66, "rain", 0.35], [80, "rain", 0.35], [63, "rain", 0.65], [81, "rain", 0.65],
    [65, "rain", 1], [67, "rain", 1], [82, "rain", 1],
    [71, "snow", 0.35], [77, "snow", 0.35], [85, "snow", 0.35], [73, "snow", 0.65], [75, "snow", 1], [86, "snow", 1],
    [95, "storm", 0.8], [96, "storm", 1], [99, "storm", 1],
  ];
  for (const [code, kind, intensity] of TABLE) {
    check(`toConditions code ${code} -> ${kind} ${intensity}`, () => {
      const c = toConditions(reading(code), now);
      assert.equal(c.kind, kind);
      assert.equal(c.intensity, intensity);
    });
  }

  check("toConditions unknown code falls back to cloud cover", () => {
    assert.equal(toConditions(reading(42, { cloud: 90 }), now).kind, "overcast");
    assert.equal(toConditions(reading(42, { cloud: 85 }), now).kind, "overcast");
    assert.equal(toConditions(reading(42, { cloud: 50 }), now).kind, "partly");
    assert.equal(toConditions(reading(42, { cloud: 10 }), now).kind, "clear");
    assert.equal(toConditions(reading(42, { cloud: undefined }), now).kind, "clear");
    assert.equal(toConditions(reading(42), now).intensity, 0);
  });

  check("toConditions passes the fields through", () => {
    const c = toConditions(reading(63, { isDay: false, wind: 33, cloud: 70, sunrise: 1000, sunset: 2000 }), now);
    assert.deepEqual(c, {
      kind: "rain", intensity: 0.65, isDay: false, wind: 33, cloud: 0.7, sunrise: 1000, sunset: 2000, at: now,
    });
  });

  check("toConditions cloud fallback by kind", () => {
    const without = (code) => toConditions(reading(code, { cloud: undefined }), now).cloud;
    assert.equal(without(0), 0.05);
    assert.equal(without(2), 0.45);
    assert.equal(without(3), 0.95);
    assert.equal(without(45), 0.95);
    assert.equal(without(63), 0.95);
    assert.equal(without(95), 0.95);
  });

  check("toConditions wind fallback is 12", () => {
    assert.equal(toConditions(reading(0, { wind: undefined }), now).wind, 12);
    assert.equal(toConditions(reading(0, { wind: null }), now).wind, 12);
  });

  check("toConditions unknown sun times are 0", () => {
    const c = toConditions(reading(0, { sunrise: undefined, sunset: null }), now);
    assert.equal(c.sunrise, 0);
    assert.equal(c.sunset, 0);
  });

  check("toConditions null data -> null", () => {
    assert.equal(toConditions(null, now), null);
    assert.equal(toConditions(undefined, now), null);
  });

  check("toConditions stale reading -> null", () => {
    const twoHours = 2 * 60 * 60 * 1000;
    assert.equal(toConditions(reading(63), now - twoHours - 1000), null);
    assert.notEqual(toConditions(reading(63), now - twoHours + 60_000), null);
    assert.equal(toConditions(reading(63), undefined), null);
  });
}

// ----- phase 2: glow tint -----
{
  const { tintGlow } = await page("background.js");
  const AURORA = [225, 280, 175];
  const KINDS = ["clear", "partly", "overcast", "fog", "drizzle", "rain", "snow", "storm"];
  const HSL = /^hsl\((\d+) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)% \/ (\d*\.?\d+)\)$/;

  check("tintGlow without conditions reproduces today's strings", () => {
    const today = { c1: "hsl(225 90% 55% / 0.5)", c2: "hsl(280 80% 55% / 0.36)", c3: "hsl(175 80% 45% / 0.3)" };
    assert.deepEqual(tintGlow(AURORA, null), today);
    assert.deepEqual(tintGlow(AURORA, undefined), today);
  });

  for (const kind of KINDS) {
    check(`tintGlow ${kind} yields three well-formed hsl() strings`, () => {
      const colours = tintGlow(AURORA, { kind });
      assert.deepEqual(Object.keys(colours), ["c1", "c2", "c3"]);
      for (const value of Object.values(colours)) {
        const match = HSL.exec(value);
        assert.ok(match, `not hsl(): ${value}`);
        const [hue, sat, light, alpha] = match.slice(1).map(Number);
        assert.ok(hue >= 0 && hue < 360, `hue ${hue}`);
        assert.ok(sat >= 0 && sat <= 100, `saturation ${sat}`);
        assert.ok(light >= 0 && light <= 100, `lightness ${light}`);
        assert.ok(alpha >= 0 && alpha <= 1, `alpha ${alpha}`);
      }
    });
  }

  check("tintGlow shifts the colours by kind", () => {
    const [, sat, light] = HSL.exec(tintGlow(AURORA, { kind: "overcast" }).c1).slice(1).map(Number);
    assert.equal(sat, 45);
    assert.equal(light, 49);
    assert.equal(tintGlow(AURORA, { kind: "snow" }).c1, "hsl(223 40.5% 69% / 0.45)");
    assert.notEqual(tintGlow(AURORA, { kind: "storm" }).c1, tintGlow(AURORA, { kind: "clear" }).c1);
  });

  check("tintGlow keeps Ember warm in rain", () => {
    const hue = Number(HSL.exec(tintGlow([14, 338, 40], { kind: "rain" }).c1)[1]);
    assert.ok(hue >= 330 || hue <= 30, `hue ${hue} is not a red`);
  });
}

// ----- phase 3: weather layer -----
{
  const { flashAlpha, weatherLayer } = await page("weather-layer.js");

  check("flashAlpha peaks at 0.13 and fades through two pulses", () => {
    assert.equal(flashAlpha(0), 0.13);
    assert.ok(flashAlpha(0.05) > 0 && flashAlpha(0.05) < 0.13);
    assert.equal(flashAlpha(0.1), 0);
    assert.equal(flashAlpha(0.13), 0);
    assert.equal(flashAlpha(0.16), 0.07);
    assert.ok(flashAlpha(0.3) > 0 && flashAlpha(0.3) < 0.07);
    assert.equal(flashAlpha(0.5), 0);
    assert.equal(flashAlpha(1), 0);
    assert.equal(flashAlpha(60), 0);
  });

  check("flashAlpha never exceeds 0.13", () => {
    for (let e = 0; e <= 1; e += 0.001) {
      const alpha = flashAlpha(e);
      assert.ok(alpha >= 0 && alpha <= 0.13, `e=${e} alpha=${alpha}`);
    }
  });

  check("weatherLayer draws nothing for clear or partly weather, or without conditions", () => {
    for (const kind of ["clear", "partly"]) {
      assert.equal(weatherLayer({ kind, intensity: 0, wind: 12 }, { moving: true, haze: true }), null);
    }
    assert.equal(weatherLayer(null, { moving: true, haze: true }), null);
  });

  check("weatherLayer returns a scene for the wet kinds, haze only when asked", () => {
    for (const kind of ["overcast", "fog", "drizzle", "rain", "snow", "storm"]) {
      const scene = weatherLayer({ kind, intensity: 0.65, wind: 12 }, { moving: true, haze: true });
      assert.equal(typeof scene?.init, "function", kind);
      assert.equal(typeof scene?.draw, "function", kind);
    }
    // Still frames show haze only, so nothing is left over the styles that draw their own cloud.
    assert.equal(weatherLayer({ kind: "rain", intensity: 0.65, wind: 12 }, { moving: false, haze: false }), null);
    assert.equal(weatherLayer({ kind: "overcast", intensity: 0, wind: 12 }, { moving: true, haze: false }), null);
    assert.notEqual(weatherLayer({ kind: "fog", intensity: 0, wind: 12 }, { moving: false, haze: false }), null);
    assert.notEqual(weatherLayer({ kind: "rain", intensity: 0.65, wind: 12 }, { moving: true, haze: false }), null);
  });
}

// ----- phase 5: sky -----
{
  const { skyTime, skyStops } = await page("sky.js");
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const sunrise = new Date(2026, 5, 21, 5, 40).getTime();
  const sunset = new Date(2026, 5, 21, 21, 10).getTime();
  const at = (ms) => skyTime(ms, sunrise, sunset);
  const inRange = (value, name) => assert.ok(value >= 0 && value <= 1, `${name} ${value} out of range`);

  const noon = at((sunrise + sunset) / 2);
  const afterRise = at(sunrise + 5 * MINUTE);
  const beforeSet = at(sunset - 5 * MINUTE);
  const night = at(sunset + 3 * HOUR);
  const preDawn = at(sunrise - 2 * HOUR);
  const unknown = skyTime(new Date(2026, 5, 21, 12, 0).getTime(), 0, 0);

  check("skyTime day: full at midday, partial at the edges, 0 at night", () => {
    assert.ok(noon.day > 0.99, `midday ${noon.day}`);
    assert.ok(afterRise.day > 0 && afterRise.day < 1, `after sunrise ${afterRise.day}`);
    assert.ok(beforeSet.day > 0 && beforeSet.day < 1, `before sunset ${beforeSet.day}`);
    assert.equal(night.day, 0);
    assert.equal(preDawn.day, 0);
  });

  check("skyTime twilight: 0 at midday, strong next to sunrise and sunset", () => {
    assert.equal(noon.twilight, 0);
    assert.ok(afterRise.twilight > 0.8, `after sunrise ${afterRise.twilight}`);
    assert.ok(beforeSet.twilight > 0.8, `before sunset ${beforeSet.twilight}`);
    assert.equal(night.twilight, 0);
  });

  check("skyTime sun and moon stay in 0..1 and increase with time", () => {
    for (const [name, value] of Object.entries({ noon, afterRise, beforeSet, night, preDawn, unknown })) {
      inRange(value.sun, `${name}.sun`);
      inRange(value.moon, `${name}.moon`);
    }
    assert.ok(afterRise.sun < noon.sun && noon.sun < beforeSet.sun, "sun over the day");
    assert.ok(Math.abs(noon.sun - 0.5) < 0.01, `midday sun ${noon.sun}`);
    assert.ok(night.moon < preDawn.moon, "moon over the night");
    assert.ok(night.moon > 0 && preDawn.moon < 1, "moon within the night");
    // By day the moon waits at the far end of its arc from the sun.
    assert.equal(afterRise.moon, 1);
    assert.equal(beforeSet.moon, 0);
  });

  check("skyTime without sun times falls back to 06:30 and 18:30 local", () => {
    assert.ok(unknown.day > 0.99, `midday ${unknown.day}`);
    assert.ok(Math.abs(unknown.sun - 0.458) < 0.01, `sun ${unknown.sun}`); // 5.5 h of 12
    assert.equal(skyTime(new Date(2026, 5, 21, 23, 0).getTime(), 0, 0).day, 0);
    assert.equal(skyTime(new Date(2026, 5, 21, 12, 0).getTime(), 5, 2).day, unknown.day); // sunset before sunrise
  });

  check("skyStops stay as dark as the day-bottom colour through a whole day", () => {
    const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // The warm twilight band at the very bottom peaks a touch (about 7%)
    // above the day-bottom blue for a few minutes either side of sunrise and
    // sunset; the plan's palette allows that much and no more.
    const limit = luminance([0x1f, 0x55, 0x84]) + 6;
    const KINDS = ["clear", "partly", "overcast", "fog", "drizzle", "rain", "snow", "storm"];
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const { day, twilight } = at(new Date(2026, 5, 21, 0, minute).getTime());
      for (const cloud of [0, 0.5, 1]) {
        for (const kind of KINDS) {
          for (const stop of skyStops(day, twilight, cloud, kind)) {
            assert.ok(luminance(stop) <= limit, `minute ${minute} cloud ${cloud} ${kind}: ${stop}`);
            stop.forEach((c) => assert.ok(c >= 0 && c <= 255));
          }
        }
      }
    }
    assert.deepEqual(skyStops(1, 0, 0, "clear"), [[10, 40, 80], [20, 66, 114], [31, 85, 132]]);
    assert.deepEqual(skyStops(0, 0, 0, "clear"), [[4, 5, 13], [10, 15, 38], [21, 27, 60]]);
  });
}

// ----- phase 6: photos -----
{
  const photos = await page("photos.js");
  const { readFileSync } = await import("node:fs");
  const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
  // Trimmed real answers: four Commons files (square, wide panorama, nearly
  // square, wide and huge) and three Art Institute prints (two impressions of
  // the Great Wave and a portrait-shaped one).
  const commons = photos.commonsImages(fixture("commons-search.json"));
  const art = photos.aicImages(fixture("aic-search.json"));
  const byId = (list, id) => list.find((image) => image.id === id);

  check("commonsImages reads title, artist, licence and a clean link", () => {
    assert.equal(commons.length, 4);
    const carina = byId(commons, "c:5254504");
    assert.equal(carina.title, "ESO - The Carina Nebula (by)");
    assert.equal(carina.license, "CC BY 4.0");
    assert.equal(carina.source, "Wikimedia Commons");
    assert.equal(carina.link, "https://commons.wikimedia.org/wiki/File:ESO_-_The_Carina_Nebula_(by).jpg");
    assert.ok(!/<|utm_/.test(JSON.stringify(commons)), "no HTML or tracking parameters left");
  });
  check("commonsImages offers the 1920 and 3840 thumbnails, or the original when it is narrower", () => {
    const [small, large] = byId(commons, "c:5254504").sizes;
    assert.equal(small[0], 1920);
    assert.match(small[1], /\/1920px-ESO_-_The_Carina_Nebula_%28by%29\.jpg$/);
    assert.equal(large[0], 3840);
    assert.match(large[1], /\/3840px-ESO_-_The_Carina_Nebula_%28by%29\.jpg$/);
    const helix = byId(commons, "c:1669175").sizes; // 4279 wide
    assert.match(helix[1][1], /\/3840px-/);
    const apollo = byId(commons, "c:189395").sizes; // 2400 wide: original for the large size
    assert.deepEqual(apollo.map(([width]) => width), [1920, 2400]);
    assert.equal(apollo[1][1], "https://upload.wikimedia.org/wikipedia/commons/f/fe/Apollo_15_flag%2C_rover%2C_LM%2C_Irwin.jpg");
  });
  check("aicImages builds IIIF URLs from the response's own iiif_url, at the widths the server allows", () => {
    assert.equal(art.length, 3);
    const wave = byId(art, "a:89503");
    assert.equal(wave.artist, "Katsushika Hokusai");
    assert.equal(wave.license, "Public domain");
    assert.equal(wave.link, "https://www.artic.edu/artworks/89503");
    assert.match(wave.title, /^Under the Wave off Kanagawa .*, 1830\/33$/);
    assert.deepEqual(
      wave.sizes.map(([width]) => width),
      [1686, 3000],
    );
    assert.equal(wave.sizes[1][1], "https://www.artic.edu/iiif/2/2fa24f36-cc26-41b6-4b49-12bba2a6c1c8/full/3000,/0/default.jpg");
    const narrow = photos.aicImages({ data: [{ id: 1, title: "T", image_id: "x", thumbnail: { width: 2500, height: 1500 } }] });
    assert.deepEqual(narrow[0].sizes.map(([width]) => width), [1686]);
    assert.match(narrow[0].sizes[0][1], /^https:\/\/www\.artic\.edu\/iiif\/2\/x\/full\/1686,\/0\/default\.jpg$/);
  });
  check("normalisers skip rows without an image and cope with empty answers", () => {
    assert.deepEqual(photos.commonsImages({}), []);
    assert.deepEqual(photos.commonsImages(null), []);
    assert.deepEqual(photos.aicImages({ data: [{ id: 1, title: "No image" }] }), []);
    assert.deepEqual(photos.commonsImages({ query: { pages: [{ pageid: 1, imageinfo: [{ url: "javascript:alert(1)", width: 3000, height: 2000 }] }] } }), []);
  });

  check("keepImage wants wide, large JPEGs with a fit title", () => {
    const kept = [...commons, ...art].filter(photos.keepImage).map((image) => image.id);
    // Square, too short a panorama (878 high), nearly square and portrait are all out.
    assert.deepEqual(kept, ["c:5254504", "a:89503", "a:77333"]);
    const base = { sizes: [[1920, "u"]], width: 3000, height: 2000, mime: "image/jpeg", title: "Hills" };
    assert.ok(photos.keepImage(base));
    assert.ok(!photos.keepImage({ ...base, width: 1800, height: 1200 }), "too narrow");
    assert.ok(!photos.keepImage({ ...base, width: 2800, height: 980 }), "too short");
    assert.ok(photos.keepImage({ ...base, width: 9000, height: 3000 }), "a 3:1 panorama is fine");
    assert.ok(!photos.keepImage({ ...base, width: 9000, height: 2900 }), "wider than 3:1 is not");
    assert.ok(!photos.keepImage({ ...base, mime: "image/png" }), "PNG");
    assert.ok(!photos.keepImage({ ...base, sizes: [] }), "no URL");
    for (const title of ["Bathers at Asnières", "Still Life with Game", "Lion skull", "Aerial view during rescue operations", "The Dead Christ"]) {
      assert.ok(!photos.keepImage({ ...base, title }), title);
    }
    assert.ok(photos.keepImage({ ...base, title: "Dead Sea salt formation" }), "Dead Sea is fine");
  });
  check("dedupe keeps one impression of the same print", () => {
    const kept = photos.dedupe(art.filter(photos.keepImage)).map((image) => image.id);
    assert.deepEqual(kept, ["a:89503"]);
    assert.equal(photos.dedupe([...commons, ...commons]).length, commons.length);
  });

  check("stripHtml turns Commons' artist HTML into text", () => {
    assert.equal(photos.stripHtml('<div class="fn value">\nNASA/Bill Anders</div>'), "NASA/Bill Anders");
    assert.equal(
      photos.stripHtml('NASA / <a href="https://en.wikipedia.org/wiki/Buzz_Aldrin" class="extiw" title="en:Buzz Aldrin">Buzz Aldrin</a>'),
      "NASA / Buzz Aldrin",
    );
    assert.equal(photos.stripHtml("Photo: <b>Ann</b> , <i>Bo</i>"), "Photo: Ann, Bo");
    assert.equal(photos.stripHtml("Tom &amp; Jerry &#8211; &#x41;&nbsp;&bogus;"), "Tom & Jerry – A &bogus;");
    assert.equal(photos.stripHtml("&#99999999;"), "&#99999999;");
    assert.equal(photos.stripHtml(undefined), "");
  });

  check("imageUrl picks the smallest size that covers the screen", () => {
    const image = { width: 6000, height: 3600, sizes: [[1920, "s"], [3840, "l"]] };
    assert.equal(photos.imageUrl(image, 1920, 1080), "s");
    assert.equal(photos.imageUrl(image, 2560, 1440), "l");
    assert.equal(photos.imageUrl(image, 7680, 4320), "l", "nothing bigger: the largest");
    // A 2.4:1 picture on a 1920x1080 screen is scaled to 2592 wide to cover it.
    const wide = { width: 4800, height: 2000, sizes: [[1920, "s"], [3840, "l"]] };
    assert.equal(photos.imageUrl(wide, 1920, 1080), "l");
    assert.equal(photos.imageUrl({ sizes: [] }, 1920, 1080), "");
  });

  const pools = {
    a: { images: [{ id: "a1", cat: "a" }, { id: "a2", cat: "a" }] },
    b: { images: [{ id: "b1", cat: "b" }] },
    c: { images: [{ id: "c1", cat: "c" }] },
  };
  const first = () => 0; // always the first option
  const last = () => 0.999; // always the last option
  check("pickNext only picks from ticked categories", () => {
    for (let i = 0; i < 50; i += 1) assert.notEqual(photos.pickNext(pools, ["a", "b"]).cat, "c");
    assert.equal(photos.pickNext(pools, ["b"], [], [], first).id, "b1");
    assert.equal(photos.pickNext(pools, ["a", "b"], [], [], last).id, "b1");
  });
  check("pickNext skips recent and hidden pictures", () => {
    assert.equal(photos.pickNext(pools, ["a"], ["a1"], [], first).id, "a2");
    assert.equal(photos.pickNext(pools, ["a"], [], new Set(["a1"]), first).id, "a2");
    // b's only picture is recent, so a fresh one from a wins whatever the dice say.
    assert.equal(photos.pickNext(pools, ["a", "b"], ["b1"], [], last).cat, "a");
  });
  check("pickNext repeats an older picture rather than show nothing, but not the one showing", () => {
    assert.equal(photos.pickNext(pools, ["a"], ["a2", "a1"], [], first).id, "a2");
    assert.equal(photos.pickNext(pools, ["b"], ["b1"], []), null, "the only picture is the one showing");
    assert.equal(photos.pickNext(pools, ["a"], [], ["a1", "a2"]), null);
    assert.equal(photos.pickNext({}, ["a"]), null, "no pool yet");
    assert.equal(photos.pickNext({ a: { images: [] }, b: pools.b }, ["a", "b"], [], [], first).id, "b1");
  });

  check("isDue: every new tab changes on load only", () => {
    const now = new Date(2026, 10, 18, 15, 0).getTime();
    assert.equal(photos.isDue(now - 1000, "tab", now, true), true);
    assert.equal(photos.isDue(now - 3 * 3600_000, "tab", now, false), false);
  });
  check("isDue: 15 minutes and hourly are rolling", () => {
    const now = new Date(2026, 10, 18, 15, 0).getTime();
    assert.equal(photos.isDue(now - 14 * 60_000, "15m", now), false);
    assert.equal(photos.isDue(now - 15 * 60_000, "15m", now), true);
    assert.equal(photos.isDue(now - 59 * 60_000, "hour", now, true), false);
    assert.equal(photos.isDue(now - 60 * 60_000, "hour", now), true);
  });
  check("isDue: daily changes at local midnight", () => {
    const evening = new Date(2026, 10, 18, 23, 50).getTime();
    assert.equal(photos.isDue(evening, "day", new Date(2026, 10, 18, 23, 59).getTime()), false);
    assert.equal(photos.isDue(evening, "day", new Date(2026, 10, 19, 0, 1).getTime()), true);
    const morning = new Date(2026, 10, 18, 0, 5).getTime();
    assert.equal(photos.isDue(morning, "day", new Date(2026, 10, 18, 23, 55).getTime(), true), false);
    assert.equal(photos.isDue(morning, "nonsense", new Date(2026, 10, 19, 0, 5).getTime()), true, "unknown means daily");
    assert.equal(photos.isDue(morning, "toString", morning + 60_000), false, "not fooled by Object.prototype");
  });
  check("isDue: nothing shown yet, or a clock set back, means due", () => {
    const now = Date.now();
    for (const refresh of ["tab", "15m", "hour", "day"]) {
      assert.equal(photos.isDue(undefined, refresh, now), true);
      assert.equal(photos.isDue(0, refresh, now), true);
      assert.equal(photos.isDue(now + 3600_000, refresh, now), true);
    }
  });

  check("poolNeedsFetch: missing, empty, stale or from other queries; not while locked or backing off", () => {
    const category = photos.PHOTO_CATEGORIES[0];
    const now = Date.now();
    const fresh = freshPool(category, now);
    assert.equal(photos.poolNeedsFetch(null, category, now), true);
    assert.equal(photos.poolNeedsFetch({ ...fresh, images: [] }, category, now), true);
    assert.equal(photos.poolNeedsFetch(fresh, category, now), false);
    assert.equal(photos.poolNeedsFetch({ ...fresh, at: now - 8 * 86400_000 }, category, now), true);
    assert.equal(photos.poolNeedsFetch({ ...fresh, q: "older queries" }, category, now), true);
    assert.equal(photos.poolNeedsFetch({ fetchingAt: now - 10_000 }, category, now), false, "another tab is on it");
    assert.equal(photos.poolNeedsFetch({ fetchingAt: now - 120_000 }, category, now), true, "that tab gave up");
    assert.equal(photos.poolNeedsFetch({ retryAt: now + 60_000 }, category, now), false);
    assert.equal(photos.poolNeedsFetch({ retryAt: now - 1 }, category, now), true);
  });
  // A pool as refreshPool() writes it, fetched just now.
  function freshPool(category, now) {
    return { q: JSON.stringify(category.searches ?? category.must), at: now, images: [{ id: "x" }] };
  }

  {
    // Run outside check() because it is async; the fake fetch answers instantly.
    const answer = (body) => ({ ok: true, json: async () => body, headers: new Map() });
    const japanese = photos.PHOTO_CATEGORIES.find((c) => c.id === "art-japanese");
    const requested = [];
    const fakeFetch = async (url) => {
      requested.push(url);
      return answer(fixture("aic-search.json"));
    };
    const batches = [];
    const result = await photos.fetchCategoryImages(japanese, {
      fetch: fakeFetch,
      rand: () => 0,
      onBatch: (images) => batches.push(images.map((image) => image.id)),
    });
    check("fetchCategoryImages (AIC) asks for public-domain works with images, two different pages", () => {
      assert.equal(requested.length, 2);
      const [one, two] = requested.map((url) => JSON.parse(url.searchParams.get("params")));
      const must = JSON.stringify(one.query.bool.must);
      assert.match(must, /"is_public_domain":true/);
      assert.match(must, /"exists":\{"field":"image_id"\}/);
      assert.match(must, /"place_of_origin.keyword":"Japan"/);
      // The first fetch knows of one page only; the answer says 63, of which the first 10 can be reached.
      assert.deepEqual([one.page, two.page], [1, 2]);
      assert.equal(result.pages, 10);
      assert.equal(result.raw, 6);
      // Both pages are the same fixture: filtered, deduplicated and tagged with the category.
      assert.deepEqual(result.images.map((image) => [image.id, image.cat]), [["a:89503", "art-japanese"]]);
    });
    check("fetchCategoryImages reports the usable images after each request, for an early first picture", () => {
      assert.deepEqual(batches, [["a:89503"], ["a:89503"]]);
    });
    const failing = async () => ({ ok: false, status: 429, headers: new Map([["retry-after", "30"]]) });
    let error = null;
    try {
      await photos.fetchCategoryImages(japanese, { fetch: failing });
    } catch (caught) {
      error = caught;
    }
    check("fetchCategoryImages reports the status and Retry-After of a refusal", () => {
      assert.ok(error);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 30);
    });
  }

  check("every category has a unique id, a name, a group and a query", () => {
    const ids = photos.PHOTO_CATEGORIES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of photos.PHOTO_CATEGORIES) {
      assert.ok(c.name && ["photo", "art"].includes(c.group), c.id);
      assert.ok(c.source === "commons" ? c.searches.length > 0 : c.must.length > 0, c.id);
    }
    for (const id of photos.DEFAULT_PHOTO_CATEGORIES) assert.ok(ids.includes(id), id);
    assert.ok(photos.REFRESH_OPTIONS.some(({ id }) => id === photos.DEFAULT_REFRESH));
  });
  const { BACKGROUNDS } = await page("background.js");
  check("the Photos style is in the catalogue with a preview", () => {
    const style = BACKGROUNDS.find((b) => b.id === "photos");
    assert.equal(style?.kind, "photo");
    assert.match(style.preview, /^url\("data:image\/svg\+xml,/);
  });
}

// ----- phase 7: bookmarks toolbar, Firefox and Chrome shapes -----
{
  const { toolbarNodes, groupsFromNodes } = await page("bookmarks.js");
  const mark = (title, url) => ({ title, url });
  const dir = (title, children) => ({ title, children });

  // Firefox: fixed ids, a type on every node, separators with a url of "data:".
  const firefoxTree = [
    {
      id: "root________",
      children: [
        { id: "menu________", type: "folder", title: "Bookmarks Menu", children: [mark("Menu only", "https://menu.example/")] },
        {
          id: "toolbar_____",
          type: "folder",
          title: "Bookmarks Toolbar",
          children: [
            { type: "bookmark", ...mark("Loose", "https://loose.example/") },
            { type: "separator", title: "", url: "data:" },
            { type: "folder", ...dir("Work", [{ type: "bookmark", ...mark("Mail", "https://mail.example/") }]) },
          ],
        },
        { id: "unfiled_____", type: "folder", title: "Other Bookmarks", children: [] },
      ],
    },
  ];

  // Chrome: numeric ids, no type, folderType on the permanent folders, and
  // possibly two bars (local and account-synced).
  const chromeTree = [
    {
      id: "0",
      title: "",
      children: [
        { id: "1", title: "Bookmarks bar", folderType: "bookmarks-bar", syncing: false, children: [mark("Local", "https://local.example/")] },
        { id: "2", title: "Other bookmarks", folderType: "other", syncing: false, children: [mark("Other", "https://other.example/")] },
        {
          id: "4",
          title: "Bookmarks bar",
          folderType: "bookmarks-bar",
          syncing: true,
          children: [
            mark("Account", "https://account.example/"),
            mark("Bookmarklet", "javascript:alert(1)"),
            dir("Reading", [mark("Feed", "https://feed.example/"), dir("Deep", [mark("Nested", "https://nested.example/")])]),
            dir("Empty", []),
          ],
        },
      ],
    },
  ];

  check("toolbarNodes finds Firefox's toolbar by id and nothing else", () => {
    assert.deepEqual(toolbarNodes(firefoxTree).map((node) => node.title), ["Loose", "", "Work"]);
  });

  check("toolbarNodes joins both of Chrome's bars, in tree order", () => {
    assert.deepEqual(toolbarNodes(chromeTree).map((node) => node.title), [
      "Local",
      "Account",
      "Bookmarklet",
      "Reading",
      "Empty",
    ]);
  });

  check("groupsFromNodes on Firefox: loose bookmarks first, separators skipped", () => {
    const groups = groupsFromNodes(toolbarNodes(firefoxTree));
    assert.deepEqual(groups.map((group) => group.title), ["Toolbar", "Work"]);
    assert.deepEqual(groups[0].sections[0].items.map((item) => item.url), ["https://loose.example/"]);
  });

  check("groupsFromNodes on Chrome: subfolders become sections, unlinkable and empty skipped", () => {
    const groups = groupsFromNodes(toolbarNodes(chromeTree));
    assert.deepEqual(groups.map((group) => group.title), ["Toolbar", "Reading"]);
    assert.deepEqual(groups[0].sections[0].items.map((item) => item.title), ["Local", "Account"]);
    assert.deepEqual(groups[1].sections.map((section) => section.title), ["", "Deep"]);
    assert.equal(groups[1].sections[1].items[0].host, "nested.example");
  });

  check("toolbarNodes on a tree with no toolbar gives nothing", () => {
    assert.deepEqual(groupsFromNodes(toolbarNodes([{ id: "0", children: [] }])), []);
  });
}

// ----- phase 8: a toolbar imported from a Firefox backup (Safari) -----
{
  const { parseFirefoxBackup } = await page("bookmarks-import.js");
  const { groupsFromNodes, linkCount, hasBookmarksApi } = await page("bookmarks.js");

  // As Firefox writes a backup: a type on every node, and the root's folders
  // marked by `root`, with internal names ("toolbar") as their titles.
  const place = (title, uri) => ({ guid: "aaaaaaaaaaaa", title, dateAdded: 1, typeCode: 1, type: "text/x-moz-place", uri });
  const container = (title, children, extra = {}) => ({
    guid: "bbbbbbbbbbbb",
    title,
    typeCode: 2,
    type: "text/x-moz-place-container",
    children,
    ...extra,
  });
  const backup = container(
    "",
    [
      container("menu", [place("Menu only", "https://menu.example/")], { guid: "menu________", root: "bookmarksMenuFolder" }),
      container(
        "toolbar",
        [
          place("Loose", "https://loose.example/"),
          { guid: "cccccccccccc", title: "", typeCode: 3, type: "text/x-moz-place-separator" },
          place("Bookmarklet", "javascript:alert(1)"),
          container("Work", [place("Mail", "https://mail.example/"), container("Infra", [place("Status", "https://status.example/")])]),
          container("Empty", []),
        ],
        { guid: "toolbar_____", root: "toolbarFolder" },
      ),
      container("unfiled", [place("Other", "https://other.example/")], { guid: "unfiled_____", root: "unfiledBookmarksFolder" }),
    ],
    { guid: "root________", root: "placesRoot" },
  );
  const text = JSON.stringify(backup);

  check("parseFirefoxBackup keeps only the toolbar, as getTree() nodes without separators", () => {
    assert.deepEqual(parseFirefoxBackup(text), [
      { type: "bookmark", title: "Loose", url: "https://loose.example/" },
      { type: "bookmark", title: "Bookmarklet", url: "javascript:alert(1)" },
      {
        type: "folder",
        title: "Work",
        children: [
          { type: "bookmark", title: "Mail", url: "https://mail.example/" },
          { type: "folder", title: "Infra", children: [{ type: "bookmark", title: "Status", url: "https://status.example/" }] },
        ],
      },
      { type: "folder", title: "Empty", children: [] },
    ]);
  });

  check("an imported toolbar gives the same cards as the real one", () => {
    const groups = groupsFromNodes(parseFirefoxBackup(text));
    assert.deepEqual(groups.map((group) => group.title), ["Toolbar", "Work"]);
    assert.deepEqual(groups[0].sections[0].items.map((item) => item.title), ["Loose"]);
    assert.deepEqual(groups[1].sections.map((section) => section.title), ["", "Infra"]);
    assert.equal(linkCount(parseFirefoxBackup(text)), 3);
  });

  check("parseFirefoxBackup refuses anything that isn't a backup with a toolbar", () => {
    const noToolbar = { ...backup, children: backup.children.filter((node) => node.root !== "toolbarFolder") };
    assert.equal(parseFirefoxBackup(JSON.stringify(noToolbar)), null);
    const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>\n</DL>';
    assert.equal(parseFirefoxBackup(html), null);
    for (const junk of ["", "{}", "null", "[]", '{"children":"nope"}']) assert.equal(parseFirefoxBackup(junk), null);
  });

  check("a toolbar found by guid alone, with untitled entries, still imports", () => {
    const bare = { children: [{ guid: "toolbar_____", type: "text/x-moz-place-container", children: [{ type: "text/x-moz-place", uri: "https://x.example/" }] }] };
    assert.deepEqual(parseFirefoxBackup(JSON.stringify(bare)), [{ type: "bookmark", title: "", url: "https://x.example/" }]);
  });

  check("hasBookmarksApi follows browser.bookmarks", () => {
    assert.equal(hasBookmarksApi(), false);
    globalThis.browser = { bookmarks: {} };
    try {
      assert.equal(hasBookmarksApi(), true);
    } finally {
      delete globalThis.browser;
    }
  });
}

// ----- phase 9: Safari signing and renewal (dev/safari.mjs) -----
{
  const {
    plistValue,
    profileExpiry,
    profileBundleId,
    renewalDue,
    renewalOutcome,
    extensionEnabled,
    extensionListed,
    agentPlist,
    launcherScript,
    aqueductArgs,
    BUNDLE_ID,
    LABEL,
    RENEW_WITHIN,
  } = await import(new URL("./safari.mjs", import.meta.url));
  const HOUR = 3600_000;
  const now = Date.UTC(2026, 10, 20, 12);

  // A free team's profile as `security cms -D` prints it, trimmed.
  const profile = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>CreationDate</key>
	<date>2026-11-18T09:00:00Z</date>
	<key>Entitlements</key>
	<dict>
		<key>com.apple.application-identifier</key>
		<string>A1B2C3D4E5.com.nullgreg.frontpage.Extension</string>
		<key>com.apple.developer.team-identifier</key>
		<string>A1B2C3D4E5</string>
	</dict>
	<key>ExpirationDate</key>
	<date>2026-11-25T09:00:00Z</date>
	<key>Name</key>
	<string>Mac Team Provisioning Profile: com.nullgreg.frontpage.Extension</string>
</dict>
</plist>`;

  check("profileExpiry and profileBundleId read a decoded profile", () => {
    assert.equal(profileExpiry(profile), Date.UTC(2026, 10, 25, 9));
    assert.equal(profileBundleId(profile), "com.nullgreg.frontpage.Extension");
    assert.equal(plistValue(profile, "com.apple.developer.team-identifier"), "A1B2C3D4E5");
    assert.equal(profileExpiry(""), null);
    assert.equal(profileBundleId("<plist/>"), null);
  });

  check("renewalDue waits until under 72 hours are left", () => {
    const base = { installed: true, now };
    assert.equal(renewalDue({ ...base, expiresAt: now + RENEW_WITHIN + HOUR }).due, false);
    assert.equal(renewalDue({ ...base, expiresAt: now + RENEW_WITHIN - HOUR }).due, true);
    assert.equal(renewalDue({ ...base, expiresAt: now - HOUR }).due, true);
    assert.equal(renewalDue({ ...base, expiresAt: null }).due, true, "an ad-hoc copy needs re-signing");
  });

  check("renewalDue holds off after a failure, after a repeated profile, and with nothing installed", () => {
    const soon = now + HOUR;
    assert.equal(renewalDue({ installed: true, now, expiresAt: soon, retryAfter: now + HOUR }).due, false);
    assert.equal(renewalDue({ installed: true, now, expiresAt: soon, waitUntil: soon }).due, false);
    assert.equal(renewalDue({ installed: true, now: soon + 1, expiresAt: soon, waitUntil: soon }).due, true);
    assert.equal(renewalDue({ installed: false, now, expiresAt: null }).due, false, "an uninstalled app isn't put back");
  });

  check("renewalDue rebuilds at once when Safari drops a copy that should still be good", () => {
    const later = now + 300 * 24 * HOUR; // a certificate-only signature, months to go
    assert.equal(renewalDue({ installed: true, now, expiresAt: later }).due, false);
    assert.equal(renewalDue({ installed: true, now, expiresAt: later, healthy: false }).due, true);
    assert.equal(renewalDue({ installed: true, now, expiresAt: later, healthy: false, waitUntil: later }).due, true);
    assert.equal(renewalDue({ installed: true, now, expiresAt: later, healthy: false, retryAfter: now + HOUR }).due, false);
  });

  check("extensionListed finds Frontpage with or without an on/off flag", () => {
    const line = "     com.nullgreg.frontpage.Extension(1.0.5058887)\t9F06\t2026-11-19 03:29:19 +0000\t/Users/me/Applications/Frontpage.app";
    assert.equal(extensionListed(line), true);
    assert.equal(extensionListed("(no matches)"), false);
    assert.equal(extensionListed("+    com.nullgreg.frontpage.other.Extension(1.0)"), false);
  });

  check("renewalOutcome tells a fresh profile from a repeated one and from failures", () => {
    const week = 7 * 24 * HOUR;
    assert.equal(renewalOutcome(now + HOUR, now + week, now), "renewed");
    assert.equal(renewalOutcome(null, now + week, now), "renewed");
    assert.equal(renewalOutcome(now + HOUR, now + HOUR, now), "same");
    assert.equal(renewalOutcome(now + HOUR, null, now), "unsigned");
    assert.equal(renewalOutcome(null, now - HOUR, now), "expired");
  });

  check("extensionEnabled reads pluginkit's flag column for Frontpage only", () => {
    const listing = [
      "+    com.example.other.Extension(2.0)\tAAAA\t2026-11-01 10:00:00 +0000\t/Applications/Other.app/Contents/PlugIns/Other.appex",
      "-    com.nullgreg.frontpage.Extension(1.4.0)\tBBBB\t2026-11-18 10:00:00 +0000\t/Users/me/Applications/Frontpage.app/Contents/PlugIns/Frontpage Extension.appex",
    ].join("\n");
    assert.equal(extensionEnabled(listing), false);
    assert.equal(extensionEnabled(listing.replace("-    com.nullgreg", "+    com.nullgreg")), true);
    assert.equal(extensionEnabled(listing.replace("-    com.nullgreg", "     com.nullgreg")), null);
    assert.equal(extensionEnabled("(no matches)"), null);
  });

  check("agentPlist starts the launcher hourly and at login, with paths escaped", () => {
    const plist = agentPlist({
      program: "/Users/me/Library/Application Support/Frontpage/Frontpage Safari Renewal",
      cwd: "/Users/me/R&D/frontpage",
      log: "/Users/me/Library/Logs/Frontpage/safari-renew.log",
      env: { PATH: "/usr/bin:/bin", VOLTA_HOME: "/Users/me/.volta" },
    });
    assert.ok(plist.includes(`<string>${LABEL}</string>`));
    assert.match(plist, /<key>ProgramArguments<\/key>\s*<array>\s*<string>[^<]*\/Frontpage Safari Renewal<\/string>\s*<\/array>/);
    assert.match(plist, /<string>\/Users\/me\/R&amp;D\/frontpage<\/string>/);
    assert.match(plist, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>VOLTA_HOME<\/key>\s*<string>\/Users\/me\/\.volta<\/string>/);
    assert.doesNotMatch(plist, /R&D/);
  });

  check("launcherScript explains itself and runs renew, quoting paths for the shell", () => {
    const script = launcherScript({ node: "/Users/me/.volta/bin/node", script: "/Users/me/Bob's code/frontpage/dev/safari.mjs", cwd: "/Users/me/Bob's code/frontpage" });
    assert.match(script, /^#!\/bin\/sh\n# Frontpage Safari Renewal\n/);
    assert.match(script, /safari:unschedule/);
    assert.ok(script.includes("cd '/Users/me/Bob'\\''s code/frontpage' || exit 1"));
    assert.ok(script.trimEnd().endsWith("exec '/Users/me/.volta/bin/node' '/Users/me/Bob'\\''s code/frontpage/dev/safari.mjs' renew"));
  });

  check("aqueductArgs signs with the team, skips the shim and leaves Safari running", () => {
    const args = aqueductArgs();
    for (const flag of ["--install", "--no-shim", "--no-safari-restart", "--background-launch", "--ci", "--clean"]) {
      assert.ok(args.includes(flag), flag);
    }
    assert.equal(args[args.indexOf("--team") + 1], "auto");
    const renewal = aqueductArgs("A1B2C3D4E5");
    assert.equal(renewal[renewal.indexOf("--team") + 1], "A1B2C3D4E5", "a known team, so Aqueduct can't fall back to ad-hoc");
    assert.equal(args[args.indexOf("--bundle-id") + 1], BUNDLE_ID);
    assert.ok(!args.includes("--verify"), "--verify opens Safari, and fails a first install that isn't turned on yet");
  });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
