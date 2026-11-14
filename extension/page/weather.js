import { getLocal, setLocal } from "./store.js";
import { icon } from "./dom.js";

const TTL = 15 * 60 * 1000;
/** Readings older than this produce no background effects. */
export const STALE = 2 * 60 * 60 * 1000;

/** Looks a place name up with Open-Meteo's geocoder. */
export async function findCities(name) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name,
    count: "6",
    language: navigator.language.split("-")[0],
    format: "json",
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geocoding failed (${response.status})`);
  const data = await response.json();
  return (data.results ?? []).map((place) => ({
    name: place.name,
    region: [place.admin1, place.country].filter(Boolean).join(", "),
    latitude: place.latitude,
    longitude: place.longitude,
  }));
}

async function fetchWeather(city, unit) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: city.latitude,
    longitude: city.longitude,
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,cloud_cover,precipitation",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    temperature_unit: unit,
    timezone: "auto",
    forecast_days: "7",
    timeformat: "unixtime",
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
  const data = await response.json();
  const seconds = (value) => (Number.isFinite(value) ? value * 1000 : 0);
  const daily = data.daily;
  // daily.time is each day's local midnight as an instant; adding the city's UTC
  // offset turns it into that calendar date at UTC midnight, which is easy to label.
  // The offset is today's, so across a DST change a date can be an hour off;
  // forecastDays() rounds it back to midnight.
  const offset = (data.utc_offset_seconds ?? 0) * 1000;
  return {
    offset,
    days: (daily.time ?? []).map((time, i) => ({
      date: seconds(time) + offset,
      code: daily.weather_code?.[i],
      high: daily.temperature_2m_max?.[i],
      low: daily.temperature_2m_min?.[i],
      rain: daily.precipitation_probability_max?.[i], // percent, may be null
    })),
    temp: data.current.temperature_2m,
    feels: data.current.apparent_temperature,
    code: data.current.weather_code,
    isDay: data.current.is_day === 1,
    high: data.daily.temperature_2m_max[0],
    low: data.daily.temperature_2m_min[0],
    wind: data.current.wind_speed_10m, // km/h
    cloud: data.current.cloud_cover, // percent
    sunrise: seconds(data.daily.sunrise?.[0]),
    sunset: seconds(data.daily.sunset?.[0]),
  };
}

// WMO weather code -> [kind, intensity] for the background effects.
const KINDS = [
  [[0, 1], "clear", 0],
  [[2], "partly", 0],
  [[3], "overcast", 0],
  [[45, 48], "fog", 0],
  [[51, 56], "drizzle", 0.35],
  [[53], "drizzle", 0.65],
  [[55, 57], "drizzle", 1],
  [[61, 66, 80], "rain", 0.35],
  [[63, 81], "rain", 0.65],
  [[65, 67, 82], "rain", 1],
  [[71, 77, 85], "snow", 0.35],
  [[73], "snow", 0.65],
  [[75, 86], "snow", 1],
  [[95], "storm", 0.8],
  [[96, 99], "storm", 1],
];

const CLOUD_FALLBACK = { clear: 0.05, partly: 0.45 };

/**
 * The weather as the background sees it, or null when there is no reading or
 * it is over two hours old (a machine that went offline must not rain forever).
 * `at` is when the reading was fetched, in epoch milliseconds.
 */
export function toConditions(data, at) {
  if (!data || !Number.isFinite(at) || Date.now() - at > STALE) return null;
  const cloud = Number.isFinite(data.cloud) ? data.cloud / 100 : null;
  let [, kind, intensity] = KINDS.find(([codes]) => codes.includes(data.code)) ?? [];
  if (!kind) {
    const cover = cloud ?? 0;
    kind = cover >= 0.85 ? "overcast" : cover >= 0.35 ? "partly" : "clear";
    intensity = 0;
  }
  return {
    kind,
    intensity,
    isDay: Boolean(data.isDay),
    wind: Number.isFinite(data.wind) ? data.wind : 12,
    cloud: cloud ?? CLOUD_FALLBACK[kind] ?? 0.95,
    sunrise: data.sunrise || 0,
    sunset: data.sunset || 0,
    at,
  };
}

/** WMO weather code -> [label, icon id]. */
function describe(code, isDay) {
  if (code === 0) return ["Clear", isDay ? "w-sun" : "w-moon"];
  if (code === 1) return ["Mostly clear", isDay ? "w-sun" : "w-moon"];
  if (code === 2) return ["Partly cloudy", isDay ? "w-partly" : "w-cloud"];
  if (code === 3) return ["Overcast", "w-cloud"];
  if (code === 45 || code === 48) return ["Fog", "w-fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "w-rain"];
  if (code >= 61 && code <= 67) return ["Rain", "w-rain"];
  if (code >= 71 && code <= 77) return ["Snow", "w-snow"];
  if (code >= 80 && code <= 82) return ["Showers", "w-rain"];
  if (code === 85 || code === 86) return ["Snow showers", "w-snow"];
  if (code >= 95) return ["Thunderstorm", "w-storm"];
  return ["Weather", "w-cloud"];
}

function span(className, text) {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

const degrees = (value) => (Number.isFinite(value) ? `${Math.round(value)}°` : "–");

const DAY = 24 * 60 * 60 * 1000;

/**
 * The forecast days from today (in the city) onward, at most seven, each with a
 * short `label` ("Today", "Fri") and a long `name` ("Today", "Friday"). A reading
 * cached yesterday thus drops the day that has gone.
 */
export function forecastDays(data, now = Date.now(), locale = undefined) {
  if (!Array.isArray(data?.days)) return [];
  const today = Math.floor((now + (data.offset ?? 0)) / DAY) * DAY;
  const short = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return data.days
    .filter((day) => Number.isFinite(day.date))
    // Snap to midnight: a date taken with an offset from the other side of a
    // DST change is an hour either side of it.
    .map((day) => ({ ...day, date: Math.round(day.date / DAY) * DAY }))
    .filter((day) => day.date >= today)
    .slice(0, 7)
    .map((day) => {
      const isToday = day.date === today;
      return {
        ...day,
        today: isToday,
        label: isToday ? "Today" : short.format(day.date),
        name: isToday ? "Today" : long.format(day.date),
      };
    });
}

// Bar colours by temperature in °C, from cold blue to hot orange.
const TEMP_STOPS = [[-5, "#7fa8ff"], [7, "#86d8e0"], [17, "#ffd98a"], [27, "#ffab70"], [36, "#ff8266"]];
const MIN_BAR = 8; // percent, so a day whose high and low coincide still shows

/**
 * The scale the forecast bars share, or null when the days carry no
 * temperatures. `at(t)` places a temperature between the week's lowest low (0)
 * and highest high (100), null for a missing one. `gradient` is a CSS gradient
 * across that span, coloured by actual temperature: a mild week stays in the
 * mild colours however wide its bars are.
 */
export function weekScale(days, unit = "celsius") {
  const all = days.flatMap((day) => [day.low, day.high]).filter(Number.isFinite);
  if (!all.length) return null;
  const min = Math.min(...all);
  const span = Math.max(...all) - min || 1;
  const percent = (value) => ((value - min) / span) * 100;
  const toUnit = unit === "fahrenheit" ? (celsius) => celsius * 1.8 + 32 : (celsius) => celsius;
  const stops = TEMP_STOPS.map(([celsius, colour]) => `${colour} ${percent(toUnit(celsius)).toFixed(1)}%`);
  return {
    at: (value) => (Number.isFinite(value) ? Math.min(100, Math.max(0, percent(value))) : null),
    gradient: `linear-gradient(90deg, ${stops.join(", ")})`,
  };
}

/** A day's bar as [from, to] percent on `scale`, or null when it has no temperatures. */
export function barSpan(scale, day) {
  const low = scale?.at(day.low);
  const high = scale?.at(day.high);
  if (low == null || high == null) return null;
  let from = Math.min(low, high);
  let to = Math.max(low, high);
  if (to - from < MIN_BAR) {
    from = Math.min(100 - MIN_BAR, Math.max(0, (from + to - MIN_BAR) / 2));
    to = from + MIN_BAR;
  }
  return [from, to];
}

/**
 * Drives the weather chip and the optional forecast list. Clicking the chip
 * always opens settings. `onConditions` gets `toConditions(...)` of whatever is
 * shown, or null when nothing is.
 */
export function initWeather(chip, { forecast, onOpenSettings, onConditions = () => {} }) {
  let request = 0;
  let wantForecast = false;
  chip.addEventListener("click", onOpenSettings);

  function showMessage(text, iconId = "w-partly") {
    chip.replaceChildren(icon(iconId), span("weather-meta", text));
    chip.title = "Weather settings";
    chip.hidden = false;
  }

  function show(city, data, unit) {
    const [label, iconId] = describe(data.code, data.isDay);
    const meta = span("weather-meta", "");
    meta.append(span("", city.name), span("", `H ${degrees(data.high)}  L ${degrees(data.low)}`));
    chip.replaceChildren(icon(iconId), span("weather-temp", degrees(data.temp)), meta);
    chip.title = `${label} in ${city.name}, feels like ${degrees(data.feels)}`;
    chip.hidden = false;
    showForecast(city, data, unit);
  }

  // A row per day: name, icon, low, a bar for the low-to-high span, high.
  function showForecast(city, data, unit) {
    const days = wantForecast ? forecastDays(data) : [];
    const scale = weekScale(days, unit);
    forecast.hidden = days.length === 0;
    forecast.setAttribute("aria-label", `7-day forecast for ${city.name}`);
    forecast.style.setProperty("--temps", scale?.gradient ?? "none");
    forecast.replaceChildren(
      ...days.map((day) => {
        const [label, iconId] = describe(day.code, true);
        const item = document.createElement("li");
        if (day.today) item.className = "today";
        const rain = Number.isFinite(day.rain) ? `, ${day.rain}% chance of precipitation` : "";
        item.title = `${day.name}: ${label}, high ${degrees(day.high)}, low ${degrees(day.low)}${rain}`;
        item.setAttribute("aria-label", item.title);

        const bar = span("forecast-bar", "");
        const range = barSpan(scale, day);
        if (range) {
          const fill = span("forecast-fill", "");
          fill.style.setProperty("--from", `${range[0].toFixed(1)}%`);
          fill.style.setProperty("--to", `${range[1].toFixed(1)}%`);
          bar.append(fill);
        }
        // The dot on today's bar is the temperature right now.
        const now = day.today ? scale?.at(data.temp) : null;
        if (now != null) {
          const dot = span("forecast-now", "");
          dot.style.left = `${now.toFixed(1)}%`;
          bar.append(dot);
        }

        item.append(
          span("forecast-day", day.label),
          icon(iconId),
          span("forecast-low", degrees(day.low)),
          bar,
          span("forecast-high", degrees(day.high)),
        );
        return item;
      }),
    );
  }

  function hideForecast() {
    forecast.hidden = true;
    forecast.replaceChildren();
  }

  async function update(city, unit, showForecastStrip = false) {
    const mine = ++request;
    wantForecast = showForecastStrip;
    if (!city) {
      showMessage("Set weather city");
      hideForecast();
      onConditions(null);
      return;
    }
    // "v3|" marks readings that carry the daily forecast as well as the wind,
    // cloud and sun fields.
    const key = `v3|${city.latitude},${city.longitude},${unit}`;
    const cache = await getLocal("weatherCache");
    if (mine !== request) return;
    const cached = cache?.key === key ? cache : null;
    if (cached) {
      show(city, cached.data, unit);
      onConditions(toConditions(cached.data, cached.at));
    }
    if (cached && Date.now() - cached.at < TTL) return;

    try {
      const data = await fetchWeather(city, unit);
      const at = Date.now();
      await setLocal("weatherCache", { key, at, data });
      if (mine === request) {
        show(city, data, unit);
        onConditions(toConditions(data, at));
      }
    } catch (error) {
      console.warn("Frontpage: weather update failed", error);
      // Keep showing stale data if we have it; otherwise say so quietly.
      if (mine === request && !cached) {
        showMessage("Weather unavailable", "w-cloud");
        hideForecast();
        onConditions(null);
      }
    }
  }

  return { update };
}
