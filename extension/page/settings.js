import { getSynced, setSynced, onStored } from "./store.js";
import { ENGINES } from "./search.js";
import { findCities } from "./weather.js";
import { BACKGROUNDS, previewOf } from "./background.js";
import { parseOwnJokes } from "./jokes.js";
import { PHOTO_CATEGORIES, DEFAULT_PHOTO_CATEGORIES, REFRESH_OPTIONS, DEFAULT_REFRESH } from "./photos.js";
import { hasBookmarksApi, importBookmarks, lastImport } from "./bookmarks.js";

const $ = (id) => document.getElementById(id);

/** "142 bookmarks from bookmarks-2026-11-18.json, imported 18 November." */
function describeImport(last) {
  if (!last) return "";
  const count = last.count === 1 ? "1 bookmark" : `${last.count} bookmarks`;
  const date = new Date(last.importedAt);
  const year = date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" };
  const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", ...year }).format(date);
  return `${count}${last.source ? ` from ${last.source}` : ""}, imported ${when}.`;
}

// Your own jokes can run long, so they are stored as an item of their own:
// Browser sync caps each item at about 8 KB, and the other settings shouldn't
// stop syncing because of them. In memory they are simply `ownJokes` on the
// settings object.
const OWN_JOKES_KEY = "ownJokes";

const DEFAULTS = {
  city: null, // { name, region, latitude, longitude }
  unit: /-US$/i.test(navigator.language) ? "fahrenheit" : "celsius",
  clock: "auto", // "auto" | "12" | "24"
  engine: "duckduckgo",
  favicons: true,
  jokes: true,
  nerdy: false, // include programming and science jokes
  name: "", // who the jokes are addressed to; empty for nobody in particular
  background: "aurora",
  animate: true,
  weatherFx: true, // the background reacts to the weather in `city`
  forecast: false, // show the 7-day forecast list for `city`
  photoCategories: DEFAULT_PHOTO_CATEGORIES, // ids from PHOTO_CATEGORIES, mixed together
  photoRefresh: DEFAULT_REFRESH, // id from REFRESH_OPTIONS
  photoHidden: [], // ids of pictures not to show again, newest last
  updatedAt: 0,
};

/** Loads settings and wires up the settings dialog. */
export async function initSettings() {
  let own = { text: "", updatedAt: 0, ...(await getSynced(OWN_JOKES_KEY, {})) };
  let ownSyncNote = "";
  let current = { ...DEFAULTS, ...(await getSynced("settings", {})), ownJokes: own.text };
  const listeners = new Set();

  const dialog = $("settings");
  const unit = $("set-unit");
  const clock = $("set-clock");
  const engine = $("set-engine");
  const favicons = $("set-favicons");
  const jokes = $("set-jokes");
  const nerdy = $("set-nerdy");
  const name = $("set-name");
  const ownJokes = $("set-own-jokes");
  const animate = $("set-animate");
  const weatherFx = $("set-weather-fx");
  const forecast = $("set-forecast");
  const photoOptions = $("photo-options");
  const photoRefresh = $("set-photo-refresh");
  const photoHint = $("photo-hint");

  const swatches = BACKGROUNDS.map((style) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.setAttribute("role", "radio");
    const art = document.createElement("span");
    art.className = "swatch-art";
    art.style.background = previewOf(style);
    button.append(art, style.name);
    button.addEventListener("click", () => update({ background: style.id }));
    $("bg-picker").append(button);
    return { id: style.id, button };
  });
  const photoBoxes = PHOTO_CATEGORIES.map((category) => {
    const label = document.createElement("label");
    label.className = "chip";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = category.id;
    const text = document.createElement("span");
    text.textContent = category.name;
    label.append(box, text);
    $(`photo-chips-${category.group}`).append(label);
    box.addEventListener("change", () => {
      const ticked = photoBoxes.filter((other) => other.checked).map((other) => other.value);
      if (!ticked.length) {
        box.checked = true;
        photoHint.textContent = "Keep at least one ticked.";
        return;
      }
      photoHint.textContent = "";
      update({ photoCategories: ticked });
    });
    return box;
  });
  for (const { id, name } of REFRESH_OPTIONS) photoRefresh.add(new Option(name, id));
  const cityInput = $("city-input");
  const cityResults = $("city-results");
  const cityMsg = $("city-msg");

  for (const [id, { name }] of Object.entries(ENGINES)) engine.add(new Option(name, id));

  function fillForm() {
    unit.value = current.unit;
    clock.value = current.clock;
    engine.value = current.engine;
    favicons.checked = current.favicons;
    jokes.checked = current.jokes;
    nerdy.checked = current.nerdy;
    name.value = current.name;
    nerdy.disabled = name.disabled = ownJokes.disabled = !current.jokes;
    // Left alone while it has focus, so a sync from elsewhere can't eat typing.
    if (document.activeElement !== ownJokes) ownJokes.value = current.ownJokes;
    const count = parseOwnJokes(current.ownJokes).length;
    const tally = count === 1 ? "1 joke of your own in the mix." : `${count} jokes of your own in the mix.`;
    $("own-jokes-status").textContent = [count ? tally : "", ownSyncNote].filter(Boolean).join(" ");
    animate.checked = current.animate;
    weatherFx.checked = current.weatherFx;
    weatherFx.disabled = !current.city;
    forecast.checked = current.forecast;
    forecast.disabled = !current.city;
    for (const { id, button } of swatches) button.setAttribute("aria-checked", String(id === current.background));
    photoOptions.hidden = current.background !== "photos";
    for (const box of photoBoxes) box.checked = current.photoCategories.includes(box.value);
    photoRefresh.value = current.photoRefresh;
    $("city-current").hidden = !current.city;
    $("city-name").textContent = current.city
      ? [current.city.name, current.city.region].filter(Boolean).join(", ")
      : "";
  }

  const emit = () => listeners.forEach((listener) => listener(current));

  function update(patch) {
    current = { ...current, ...patch, updatedAt: Date.now() };
    fillForm();
    emit();
    const { ownJokes: _storedSeparately, ...rest } = current;
    setSynced("settings", rest);
  }

  async function updateOwnJokes(text) {
    own = { text, updatedAt: Date.now() };
    current = { ...current, ownJokes: text };
    fillForm();
    emit();
    const synced = await setSynced(OWN_JOKES_KEY, own);
    ownSyncNote = synced ? "" : "Too long to sync, so saved on this device only.";
    fillForm();
  }

  unit.addEventListener("change", () => update({ unit: unit.value }));
  clock.addEventListener("change", () => update({ clock: clock.value }));
  engine.addEventListener("change", () => update({ engine: engine.value }));
  favicons.addEventListener("change", () => update({ favicons: favicons.checked }));
  jokes.addEventListener("change", () => update({ jokes: jokes.checked }));
  nerdy.addEventListener("change", () => update({ nerdy: nerdy.checked }));
  // "change" fires on Enter or when the field loses focus, not on every keystroke.
  name.addEventListener("change", () => update({ name: name.value.trim() }));
  ownJokes.addEventListener("change", () => updateOwnJokes(ownJokes.value));
  animate.addEventListener("change", () => update({ animate: animate.checked }));
  weatherFx.addEventListener("change", () => update({ weatherFx: weatherFx.checked }));
  forecast.addEventListener("change", () => update({ forecast: forecast.checked }));
  photoRefresh.addEventListener("change", () => update({ photoRefresh: photoRefresh.value }));

  function message(text) {
    cityMsg.textContent = text;
    cityMsg.hidden = !text;
  }

  $("city-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = cityInput.value.trim();
    if (!name) return;
    cityResults.replaceChildren();
    message("Searching…");
    try {
      const places = await findCities(name);
      message(places.length ? "" : `No places found for "${name}".`);
      cityResults.replaceChildren(
        ...places.map((place) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = place.name;
          if (place.region) {
            const region = document.createElement("small");
            region.textContent = place.region;
            button.append(region);
          }
          button.addEventListener("click", () => {
            cityInput.value = "";
            cityResults.replaceChildren();
            update({ city: place });
          });
          item.append(button);
          return item;
        }),
      );
    } catch (error) {
      console.warn("Frontpage: city lookup failed", error);
      message("Couldn't look that up. Check your connection and try again.");
    }
  });

  $("city-clear").addEventListener("click", () => update({ city: null }));

  // Safari gives extensions no bookmarks API, so there the toolbar comes from
  // a Firefox backup picked here.
  if (!hasBookmarksApi()) {
    const file = $("bookmarks-file");
    const status = $("bookmarks-status");
    $("bookmarks-field").hidden = false;
    $("bookmarks-import").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const [picked] = file.files;
      // Cleared so that picking the same file again, after a fresh backup, still counts as a change.
      file.value = "";
      if (!picked) return;
      try {
        const count = await importBookmarks(await picked.text(), picked.name);
        status.textContent =
          count == null
            ? "That isn't a Firefox bookmarks backup. In Firefox, use Backup… rather than Export Bookmarks to HTML."
            : describeImport(await lastImport());
      } catch (error) {
        console.warn("Frontpage: bookmark import failed", error);
        status.textContent = "Couldn't import that file. Try again with a fresh backup.";
      }
    });
    lastImport().then((last) => {
      status.textContent = describeImport(last);
    });
  }

  $("settings-toggle").addEventListener("click", open);
  $("settings-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close(); // click on the dimmed backdrop
  });

  // Changes made in another tab, or synced from another machine.
  onStored("settings", (incoming) => {
    if ((incoming.updatedAt ?? 0) <= current.updatedAt) return;
    current = { ...DEFAULTS, ...incoming, ownJokes: own.text };
    fillForm();
    emit();
  });
  onStored(OWN_JOKES_KEY, (incoming) => {
    if ((incoming.updatedAt ?? 0) <= own.updatedAt) return;
    own = { text: "", ...incoming };
    current = { ...current, ownJokes: own.text };
    fillForm();
    emit();
  });

  function open() {
    cityResults.replaceChildren();
    message("");
    photoHint.textContent = "";
    fillForm();
    if (!dialog.open) dialog.showModal();
  }

  fillForm();
  return {
    get: () => current,
    /** Changes some settings, as if they were changed in the dialog. */
    set: update,
    open,
    onChange: (listener) => listeners.add(listener),
  };
}
