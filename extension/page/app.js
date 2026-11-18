import { initSettings } from "./settings.js";
import { loadGroups, createGrid, watchBookmarks } from "./bookmarks.js";
import { createSearch } from "./search.js";
import { initWeather } from "./weather.js";
import { initNotes } from "./notes.js";
import { initJokes } from "./jokes.js";
import { initBackground } from "./background.js";

const $ = (id) => document.getElementById(id);

// Painted first, from the last-used choice, so there is no flash while settings load.
const background = initBackground(document.querySelector(".backdrop"), {
  credit: $("photo-credit"),
  onHidePhoto: hidePhoto,
});

let settingsLoaded = false; // declared before the await, so hidePhoto() can read it during it
const settings = await initSettings();
settingsLoaded = true;

// Only the newest few hundred are kept, so the settings stay within what
// Firefox Sync takes per item. The remembered picture can show before the
// settings have loaded; a click that early just skips the picture.
function hidePhoto(id) {
  if (!settingsLoaded) return;
  const hidden = settings.get().photoHidden.filter((other) => other !== id);
  settings.set({ photoHidden: [...hidden, id].slice(-300) });
}

// ----- clock -----
function renderClock() {
  const now = new Date();
  const mode = settings.get().clock;
  const options = { hour: "numeric", minute: "2-digit" };
  if (mode === "12") options.hour12 = true;
  if (mode === "24") Object.assign(options, { hour: "2-digit", hourCycle: "h23" });

  const parts = new Intl.DateTimeFormat(undefined, options).formatToParts(now);
  $("clock-time").textContent = parts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  $("clock-period").textContent = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  $("clock").dateTime = now.toISOString();
  $("date").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

function tick() {
  renderClock();
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 25);
}

// ----- bookmarks -----
const grid = createGrid($("grid"));
let entries = [];
let signature = null;

const search = createSearch({
  input: $("search"),
  form: $("search-form"),
  hint: $("search-hint"),
  getEntries: () => entries,
  getEngine: () => settings.get().engine,
  onFiltered: grid.layout,
});

async function refreshBookmarks() {
  const { favicons } = settings.get();
  let groups;
  try {
    groups = await loadGroups();
  } catch (error) {
    console.error("Frontpage: could not read bookmarks", error);
    return;
  }
  const next = JSON.stringify([favicons, groups]);
  if (next === signature) return;
  signature = next;
  entries = grid.render(groups, { favicons });
  search.refresh();
}

// ----- widgets -----
// Latest weather reading as the background consumes it. Left undefined until the
// weather module reports, so apply() does not wipe the background's remembered weather.
let conditions;
const weather = initWeather($("weather"), {
  forecast: $("forecast"),
  onOpenSettings: settings.open,
  onConditions(next) {
    conditions = next;
    background.setWeather(conditions, settings.get().weatherFx);
  },
});
const jokes = initJokes($("joke"));

function apply(current) {
  background.setPhotos({
    categories: current.photoCategories,
    refresh: current.photoRefresh,
    hidden: current.photoHidden,
  });
  background.set(current.background, current.animate);
  background.setWeather(conditions, current.weatherFx);
  renderClock();
  jokes.configure({
    enabled: current.jokes,
    name: current.name,
    nerdy: current.nerdy,
    ownText: current.ownJokes,
  });
  weather.update(current.city, current.unit, current.forecast);
  refreshBookmarks();
}

settings.onChange(apply);
tick();
apply(settings.get());
watchBookmarks(refreshBookmarks);
initNotes();

function updateWeather() {
  const { city, unit, forecast } = settings.get();
  weather.update(city, unit, forecast);
}

// A tab left showing (on a second monitor, say) still has to pick up new
// weather and let old readings expire. update() only fetches once the cached
// reading is past its TTL, so checking more often than that costs nothing.
setInterval(() => {
  if (document.visibilityState === "visible") updateWeather();
}, 5 * 60 * 1000);

// Coming back to a tab that has been open a while: catch everything up.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  renderClock();
  updateWeather();
  refreshBookmarks();
});
