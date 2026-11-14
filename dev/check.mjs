// Checks for the pure functions in extension/page/. Run: node dev/check.mjs
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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
