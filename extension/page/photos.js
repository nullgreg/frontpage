// The Photos background: featured pictures from Wikimedia Commons and
// public-domain art from the Art Institute of Chicago. Neither needs an
// account or a key.
//
// Commons turns away bursts of anonymous API calls, so each ticked category
// keeps a pool of candidates in storage.local and fetches a fresh random
// selection only once a week. The picture showing, the next one (already
// preloaded) and the ones shown recently live in localStorage, so a new tab
// can paint its picture before async storage has answered.
//
// Nothing at the top level touches the DOM: dev/check.mjs imports this under Node.
import { getLocal, setLocal } from "./store.js";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const AIC_API = "https://api.artic.edu/api/v1/artworks/search";
const AIC_IIIF = "https://www.artic.edu/iiif/2";

const commons = (...searches) => ({ source: "commons", searches });
// Featured-picture categories, for incategory: (files directly in any of them).
const featured = (...names) => `incategory:"${names.map((name) => `Featured_pictures_of_${name.replaceAll(" ", "_")}`).join("|")}"`;
const aic = (...must) => ({ source: "aic", must });
const term = (field, value) => ({ term: { [`${field}.keyword`]: value } });
const terms = (field, values) => ({ terms: { [`${field}.keyword`]: values } });
const before = (year) => ({ range: { date_end: { lte: year } } });

/**
 * The categories offered in settings. Commons ones are CirrusSearch queries
 * over its featured pictures (several queries are combined); AIC ones are
 * Elasticsearch filters, to which public domain and "has an image" are added.
 * `batches` is how many random batches of results a weekly refresh fetches:
 * per query for Commons (default 1, 50 files each), pages of 100 for AIC
 * (default 2). Commons counts every request against a tight limit.
 */
export const PHOTO_CATEGORIES = [
  {
    id: "space",
    name: "Space",
    group: "photo",
    // Named one by one: the astronomy category's own tree wanders off into sunsets and piers.
    ...commons(
      featured("astronomy", "galaxies", "the Milky Way", "stars in the Milky Way", "aurora", "solar eclipses", "Solar System", "planets"),
      featured("the Moon", "Mars", "Saturn", "Jupiter", "nebulae in the Large Magellanic Cloud"),
      'deepcat:"Featured pictures of nebulae in the Milky Way"',
    ),
  },
  // Many landscapes and cityscapes are panoramas too wide to use, hence the extra batch.
  { id: "landscapes", name: "Landscapes", group: "photo", batches: 2, ...commons(featured("landscapes")) },
  {
    id: "seascapes",
    name: "Seascapes",
    group: "photo",
    ...commons(featured("coasts", "beaches"), 'deepcat:"Featured pictures of oceans"'),
  },
  {
    id: "animals",
    name: "Animals",
    group: "photo",
    ...commons(
      'deepcat:"Featured pictures of mammals" -incategory:"Featured_pictures_of_mammals_(bones_and_fossils)"',
      'deepcat:"Featured pictures of birds"',
    ),
  },
  { id: "cities", name: "Cities & architecture", group: "photo", batches: 2, ...commons(featured("cityscapes", "architecture")) },
  { id: "mountains", name: "Mountains & forests", group: "photo", ...commons(featured("mountains", "forests")) },
  {
    id: "flowers",
    name: "Flowers & plants",
    group: "photo",
    // Most flower pictures are close-ups in portrait or square, so it takes more to find wide ones.
    batches: 2,
    ...commons(featured("flowers", "gardens"), 'deepcat:"Featured pictures of plants"'),
  },
  {
    id: "aerial",
    name: "Earth from above",
    group: "photo",
    ...commons(featured("Earth from space"), 'intitle:/[Aa]erial|ISS0[0-9]+-E/ incategory:"Featured_pictures_on_Wikimedia_Commons"'),
  },
  {
    id: "art-impressionist",
    name: "Impressionist",
    group: "art",
    ...aic(term("artwork_type_title", "Painting"), terms("style_title", ["Impressionism", "Post-Impressionism"])),
  },
  {
    id: "art-old-masters",
    name: "Old Masters",
    group: "art",
    batches: 3, // many are portraits
    ...aic(term("artwork_type_title", "Painting"), term("department_title", "Painting and Sculpture of Europe"), before(1800)),
  },
  {
    id: "art-japanese",
    name: "Japanese prints",
    group: "art",
    ...aic(term("artwork_type_title", "Print"), term("place_of_origin", "Japan"), before(1900)),
  },
  {
    id: "art-asian-ink",
    name: "Asian ink painting",
    group: "art",
    ...aic(term("artwork_type_title", "Painting"), terms("place_of_origin", ["China", "Japan", "Korea"])),
  },
];

export const DEFAULT_PHOTO_CATEGORIES = ["landscapes", "seascapes", "mountains"];

export const REFRESH_OPTIONS = [
  { id: "tab", name: "Every new tab" },
  { id: "15m", name: "Every 15 minutes" },
  { id: "hour", name: "Every hour" },
  { id: "day", name: "Every day" },
];
export const DEFAULT_REFRESH = "day";

const byId = (id) => PHOTO_CATEGORIES.find((category) => category.id === id);

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// ---------- filtering ----------

const MIN_WIDTH = 1900;
// Tall enough to cover a 1080p screen, panoramas included, without stretching.
const MIN_HEIGHT = 1000;
// A little narrower than 16:10 still crops well. Featured landscapes are
// often panoramas: up to 3:1 the middle of one still makes a good picture.
const MIN_ASPECT = 1.3;
const MAX_ASPECT = 3;
// Kept off a screen that may be on at work, and off a calm new tab. Titles
// only, so it's coarse; the "Don't show this again" button covers the rest.
// "Dead Sea" is fine.
const STOP_WORDS = new RegExp(
  [
    "\\b(nudes?|naked|bathers?|bathing|venus|odalisques?|leda|susanna|danae",
    "corpses?|carcass(es)?|slaughter|massacre|martyrdom|execution|prey|kill(s|ed|ing)?|game",
    "skulls?|skeletons?|fossils?|specimens?|taxidermy|mnhn",
    "september 11|rescue|bomb(s|ing)?|explosion|wreck(age)?|disaster|destroyed)\\b|\\bdead\\b(?! sea)",
  ].join("|"),
  "i",
);

/** Whether a normalised image is fit to be a background. */
export function keepImage(image) {
  return (
    Boolean(image?.sizes?.length) &&
    image.width >= MIN_WIDTH &&
    image.height >= MIN_HEIGHT &&
    image.width / image.height >= MIN_ASPECT &&
    image.width / image.height <= MAX_ASPECT &&
    // PNG photos are rare and their thumbnails are huge, so JPEG only.
    image.mime === "image/jpeg" &&
    !STOP_WORDS.test(image.title)
  );
}

/** Drops repeats: the same id, or the same work by the same artist (prints come in several impressions). */
export function dedupe(images) {
  const seen = new Set();
  return images.filter((image) => {
    const keys = [image.id, `${image.work ?? image.title}|${image.artist}`.toLowerCase()];
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text from the bits of HTML that Commons puts in its metadata. */
export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, name) => {
      if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? match;
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:)])/g, "$1")
    .replace(/\( /g, "(")
    .trim();
}

/** The URL without the utm_* tracking parameters Commons adds, or "" if it isn't a web address. */
function cleanUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    for (const key of [...parsed.searchParams.keys()]) if (key.startsWith("utm_")) parsed.searchParams.delete(key);
    return parsed.href;
  } catch {
    return "";
  }
}

// ---------- normalising API responses ----------
// Every image becomes { id, cat, title, artist, license, link, source, width,
// height, mime, sizes }, where sizes is [[width, url], ...] smallest first.
// Art also has `work`, the title without its date, to spot repeats by.

/** Images from a Commons generator=search response with imageinfo (url|size|mime|extmetadata, iiurlwidth=1920). */
export function commonsImages(json) {
  return (json?.query?.pages ?? []).flatMap((page) => {
    const info = page.imageinfo?.[0];
    const original = cleanUrl(info?.url);
    if (!original || !info.width || !info.height) return [];
    const meta = info.extmetadata ?? {};
    const text = (key) => stripHtml(meta[key]?.value);
    // Commons serves thumbnails at fixed widths; 1920 and 3840 are two of
    // them, and the width is part of the URL. Narrower than a step, the
    // original is the sharpest version on offer.
    const thumb = cleanUrl(info.thumburl);
    const step = (size) =>
      info.width > size && /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, `/${size}px-`) : original;
    const fileName = String(page.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    return [
      {
        id: `c:${page.pageid}`,
        title: text("ObjectName") || fileName,
        artist: text("Artist"),
        license: text("LicenseShortName"),
        link: cleanUrl(info.descriptionurl),
        source: "Wikimedia Commons",
        width: info.width,
        height: info.height,
        mime: info.mime,
        sizes: [
          [Math.min(1920, info.width), step(1920)],
          [Math.min(3840, info.width), step(3840)],
        ],
      },
    ];
  });
}

/** Images from an Art Institute of Chicago artworks search response. */
export function aicImages(json) {
  const iiif = typeof json?.config?.iiif_url === "string" ? json.config.iiif_url : AIC_IIIF;
  return (json?.data ?? []).flatMap((row) => {
    const { width, height } = row.thumbnail ?? {};
    if (!row.id || !row.image_id || !width || !height) return [];
    const url = (size) => `${iiif}/${row.image_id}/full/${size},/0/default.jpg`;
    const title = stripHtml(row.title);
    const date = stripHtml(row.date_display);
    return [
      {
        id: `a:${row.id}`,
        title: date ? `${title}, ${date}` : title,
        work: title,
        artist: stripHtml(row.artist_title),
        license: "Public domain",
        link: `https://www.artic.edu/artworks/${row.id}`,
        source: "Art Institute of Chicago",
        width,
        height,
        mime: "image/jpeg",
        // The IIIF server only hands out certain widths: 1686 and 3000 work, 2560 doesn't.
        sizes: width >= 3000 ? [[1686, url(1686)], [3000, url(3000)]] : [[1686, url(1686)]],
      },
    ];
  });
}

/**
 * The URL to load for a screen `width` x `height` device pixels. The picture
 * covers the screen, so one wider than the screen's shape is scaled to the
 * screen's height and needs more than the screen's width.
 */
export function imageUrl(image, width, height = 0) {
  const sizes = image?.sizes ?? [];
  const needed = Math.max(width, image?.height ? (height * image.width) / image.height : 0);
  return (sizes.find(([size]) => size >= needed) ?? sizes.at(-1))?.[1] ?? "";
}

// ---------- choosing ----------

/**
 * A random image from the ticked `categories`: first a category, then an
 * image in it, skipping `hidden` ids and, while any are left, `recent` ones.
 * `pools` maps category id to { images }. Returns null when there is nothing.
 */
export function pickNext(pools, categories, recent = [], hidden = [], rand = Math.random) {
  const skip = hidden instanceof Set ? hidden : new Set(hidden);
  const seen = new Set(recent);
  const last = recent.at(-1);
  const lists = (fresh) =>
    categories
      .map((id) => (pools[id]?.images ?? []).filter((image) => !skip.has(image.id) && (fresh ? !seen.has(image.id) : image.id !== last)))
      .filter((list) => list.length);
  let options = lists(true);
  if (!options.length) options = lists(false);
  if (!options.length) return null;
  const list = options[Math.floor(rand() * options.length)];
  return list[Math.floor(rand() * list.length)];
}

const INTERVALS = { "15m": 15 * MINUTE, hour: 60 * MINUTE };

/**
 * Whether the picture shown at `shownAt` should give way to a new one.
 * "tab" changes only when a page opens (`onLoad`); "15m" and "hour" are
 * rolling; "day" changes at local midnight.
 */
export function isDue(shownAt, refresh, now = Date.now(), onLoad = false) {
  // Nothing shown yet, or the clock was set back past it.
  if (!Number.isFinite(shownAt) || shownAt <= 0 || shownAt > now + MINUTE) return true;
  if (refresh === "tab") return onLoad;
  if (Object.hasOwn(INTERVALS, refresh)) return now - shownAt >= INTERVALS[refresh];
  return new Date(shownAt).toDateString() !== new Date(now).toDateString();
}

// ---------- fetching ----------

const COMMONS_BATCH = 50; // the most an anonymous search returns at once
const COMMONS_GAP_MS = 4000; // between Commons requests, to stay clear of its rate limit
const AIC_LIMIT = 100;
const AIC_MAX_PAGE = 10; // its search refuses to page past the first 1,000 results
const AIC_FIELDS = ["id", "title", "artist_title", "date_display", "image_id", "thumbnail"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Commons requests from this page go out one at a time, spaced apart.
let commonsTurn = Promise.resolve();
let lastCommonsAt = 0;
function commonsSlot() {
  const turn = commonsTurn.then(async () => {
    const wait = lastCommonsAt + COMMONS_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCommonsAt = Date.now();
  });
  commonsTurn = turn;
  return turn;
}

async function getJson(url, fetchImpl) {
  // Neither service needs to know which page asked, or see its cookies. (The
  // Art Institute's Cloudflare also turns away a localhost Referer, which is
  // what the dev preview sends.)
  const response = await fetchImpl(url, { referrerPolicy: "no-referrer", credentials: "omit" });
  if (!response.ok) {
    const error = new Error(`${url.hostname} answered ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after")) || 0;
    throw error;
  }
  return response.json();
}

// `requestid` only comes back in the answer, but it makes each URL different:
// Commons caches anonymous CORS answers for an hour, and a repeated URL would
// get the same "random" batch again.
function commonsUrl(search, requestid) {
  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    requestid,
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*", // anonymous CORS
    generator: "search",
    gsrsearch: `${search} filetype:bitmap filew:>${MIN_WIDTH - 1}`,
    gsrnamespace: "6",
    gsrlimit: String(COMMONS_BATCH),
    gsrsort: "random",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|ObjectName",
    iiurlwidth: "1920",
  });
  return url;
}

function aicUrl(category, page) {
  const query = {
    bool: { must: [...category.must, { term: { is_public_domain: true } }, { exists: { field: "image_id" } }] },
  };
  const url = new URL(AIC_API);
  // A GET with the query in `params` is a simple request: no CORS preflight.
  url.search = new URLSearchParams({ params: JSON.stringify({ query, fields: AIC_FIELDS, limit: AIC_LIMIT, page }) });
  return url;
}

/**
 * Fetches a fresh random selection for `category`. Returns { images, raw,
 * pages }: the usable images, how many results came back before filtering,
 * and (for AIC) how many pages of results there are, so the next fetch can
 * start at a random one. `onBatch(images)` hears the usable images so far
 * after each request. `fetch` and `rand` can be swapped for testing.
 */
export async function fetchCategoryImages(
  category,
  { fetch: fetchImpl = fetch, pages = 0, rand = Math.random, onBatch } = {},
) {
  const found = [];
  let raw = 0;
  const usable = () => dedupe(found.filter(keepImage)).map((image) => ({ ...image, cat: category.id }));
  if (category.source === "commons") {
    for (const search of category.searches) {
      // Each random batch mostly adds new pictures; a category smaller than
      // one batch doesn't need more than the first.
      for (let batch = 0; batch < (category.batches ?? 1); batch += 1) {
        await commonsSlot();
        const requestid = `${Math.floor(rand() * 2 ** 32).toString(36)}-${batch}`;
        const json = await getJson(commonsUrl(search, requestid), fetchImpl);
        const results = json?.query?.pages ?? [];
        raw += results.length;
        found.push(...commonsImages(json));
        await onBatch?.(usable());
        if (results.length < COMMONS_BATCH) break;
      }
    }
  } else {
    // The first page is picked from the count the last fetch learned (just
    // page 1 the first time); the answer says how many there are for the rest.
    const known = Math.max(1, Math.min(pages || 1, AIC_MAX_PAGE));
    const first = 1 + Math.floor(rand() * known);
    const json = await getJson(aicUrl(category, first), fetchImpl);
    pages = Math.max(1, Math.min(json?.pagination?.total_pages ?? 1, AIC_MAX_PAGE));
    raw += json?.data?.length ?? 0;
    found.push(...aicImages(json));
    await onBatch?.(usable());
    const others = Array.from({ length: pages }, (_, i) => i + 1).filter((page) => page !== first);
    for (let batch = 1; batch < (category.batches ?? 2) && others.length; batch += 1) {
      const [page] = others.splice(Math.floor(rand() * others.length), 1);
      const more = await getJson(aicUrl(category, page), fetchImpl);
      raw += more?.data?.length ?? 0;
      found.push(...aicImages(more));
      await onBatch?.(usable());
    }
  }
  return { images: usable(), raw, pages };
}

// ---------- pools ----------

const POOL_TTL = 7 * DAY;
const FETCH_LOCK_MS = 60 * 1000; // another tab started fetching this long ago at most: leave it to them
const RETRY_MS = 30 * MINUTE;

const poolKey = (id) => `photoPool:${id}`;
// A pool fetched with different queries (an older version) is refetched.
const signature = (category) => JSON.stringify(category.searches ?? category.must);

/** Whether `pool` (or no pool) for `category` should be fetched again at `now`. */
export function poolNeedsFetch(pool, category, now = Date.now()) {
  if (pool?.fetchingAt && now - pool.fetchingAt < FETCH_LOCK_MS) return false;
  if (pool?.retryAt && now < pool.retryAt) return false;
  return !pool?.images?.length || pool.q !== signature(category) || !(now - pool.at < POOL_TTL);
}

/**
 * Fetches a fresh pool for `category` if it needs one, and returns the pool.
 * With nothing to show yet, the first batch is saved straight away (marked
 * stale, so it's replaced if the fetch never finishes) and `onFirst()` is
 * called, so a picture can show while the rest arrives.
 */
async function refreshPool(category, onFirst) {
  const key = poolKey(category.id);
  const pool = await getLocal(key, null);
  if (!poolNeedsFetch(pool, category)) return pool;
  const fetchingAt = Date.now();
  await setLocal(key, { ...pool, fetchingAt });
  let early = Boolean(pool?.images?.length);
  const onBatch = async (images) => {
    if (early || !images.length) return;
    early = true;
    await setLocal(key, { q: signature(category), at: 0, fetchingAt, images });
    onFirst?.();
  };
  try {
    const { images, pages } = await fetchCategoryImages(category, { pages: pool?.pages, onBatch });
    // An empty answer keeps whatever was there rather than leaving nothing to show.
    const next = { q: signature(category), at: Date.now(), pages, images: images.length ? images : (pool?.images ?? []) };
    await setLocal(key, next);
    return next;
  } catch (error) {
    console.warn(`Frontpage: could not fetch ${category.name} pictures`, error);
    const wait = error.retryAfter ? Math.max(60, error.retryAfter) * 1000 : RETRY_MS;
    // What's stored now, which may include an early first batch.
    const next = { ...(await getLocal(key, pool)), fetchingAt: 0, retryAt: Date.now() + wait };
    await setLocal(key, next);
    return next;
  }
}

async function readPools(ids) {
  const entries = await Promise.all(ids.map(async (id) => [id, await getLocal(poolKey(id), null)]));
  return Object.fromEntries(entries);
}

// ---------- the layer ----------

const STATE_KEY = "frontpage.photo";
const RECENT = 30;
const FADE_MS = 1200; // matches the opacity transition in style.css
const CREDIT_MS = 5000; // how long the credit shows after a click on the background
const MAX_FAILURES = 3;

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: every page just picks afresh */
  }
}

function normalise(options) {
  const categories = (options?.categories ?? []).filter((id) => byId(id));
  return {
    categories: categories.length ? categories : DEFAULT_PHOTO_CATEGORIES,
    refresh: REFRESH_OPTIONS.some(({ id }) => id === options?.refresh) ? options.refresh : DEFAULT_REFRESH,
    hidden: Array.isArray(options?.hidden) ? options.hidden : [],
  };
}

/**
 * Runs the photo layer inside the backdrop `root` (two <img> in `.photo`)
 * and the credit footer `credit`. `onHide(id)` is called when someone asks
 * never to see a picture again, so it can be saved with the settings.
 */
export function createPhotoLayer(root, { credit, onHide } = {}) {
  const imgs = [...root.querySelectorAll(".photo img")];
  const link = credit?.querySelector(".photo-link");
  const note = credit?.querySelector(".photo-msg");
  let front = 0; // index in imgs of the picture showing
  let shown = null; // the image object showing
  let pendingId = null; // the one being fetched and decoded
  let loading = false;
  let advancing = null; // the advance() in progress, so two never overlap
  let running = false;
  let moving = false;
  let instantUntil = 0; // a picture ready this soon after start() (from the cache) appears without a fade
  let options = null;
  let hidden = new Set();
  let optionsKey = "";
  let checkedOnLoad = false;
  let token = 0; // bumped by every show(), so a slow load can't replace a newer one
  let failures = 0;
  let filling = null;
  let timer = 0;
  let fadeTimer = 0;
  let nextTimer = 0;
  let creditTimer = 0;

  // The screen in device pixels: a window can be made larger than it opened.
  const screenSize = () => {
    const ratio = window.devicePixelRatio || 1;
    return [
      Math.round(Math.max(window.innerWidth, window.screen?.width ?? 0) * ratio),
      Math.round(Math.max(window.innerHeight, window.screen?.height ?? 0) * ratio),
    ];
  };

  const acceptable = (image) =>
    Boolean(image?.sizes?.length) && options.categories.includes(image.cat) && !hidden.has(image.id);

  // The credit stays out of sight until the background is clicked, then
  // fades in for CREDIT_MS (longer while the pointer or focus is on it).
  // A message (loading, or a failure) stays up until it's cleared.
  function revealCredit() {
    if (!credit || credit.hidden) return;
    credit.classList.add("shown");
    concealCreditSoon();
  }

  function concealCreditSoon() {
    clearTimeout(creditTimer);
    creditTimer = setTimeout(() => {
      if (!note.hidden || credit.matches(":hover, :focus-within")) return;
      credit.classList.remove("shown");
    }, CREDIT_MS);
  }

  function message(text) {
    if (!credit) return;
    note.textContent = text;
    note.hidden = !text;
    link.hidden = Boolean(text) || !shown;
    credit.hidden = !text && !shown;
    if (text) {
      clearTimeout(creditTimer);
      credit.classList.add("shown");
    } else if (credit.classList.contains("shown")) {
      concealCreditSoon();
    }
  }

  function setCredit(image) {
    if (!credit) return;
    const title = document.createElement("span");
    title.className = "photo-title";
    title.textContent = image.title;
    const rest = [image.artist, image.license, image.source].filter(Boolean).join(" · ");
    link.replaceChildren(title, rest ? ` — ${rest}` : "");
    link.title = rest ? `${image.title} — ${rest}` : image.title;
    if (image.link) link.href = image.link;
    else link.removeAttribute("href");
    message("");
  }

  // Resolves once `url` has loaded (and is in the image cache), rejects if it can't.
  function load(url) {
    return new Promise((resolve, reject) => {
      const probe = new Image();
      probe.referrerPolicy = "no-referrer";
      probe.onload = () => resolve();
      probe.onerror = () => reject(new Error(`could not load ${url}`));
      probe.src = url;
    });
  }

  function show(image) {
    if (image.id === shown?.id || image.id === pendingId) return;
    const mine = (token += 1);
    loading = true;
    pendingId = image.id;
    const url = imageUrl(image, ...screenSize());
    // Loaded off to the side first: the <img> elements only ever get a picture
    // that is ready, and a failure here is a real one. (Firefox can reject an
    // <img>'s decode() just because its src changed again, which looked the same.)
    load(url).then(
      async () => {
        if (mine !== token || !running) return;
        const back = imgs[1 - front];
        back.classList.remove("on", "top");
        back.src = url;
        await back.decode().catch(() => {}); // from the cache, so this is quick; a fade needs it decoded
        if (mine !== token || !running) return;
        loading = false;
        pendingId = null;
        failures = 0;
        const still = !moving || performance.now() < instantUntil;
        back.classList.toggle("instant", still);
        back.classList.add("on", "top");
        const old = imgs[front];
        old.classList.remove("top");
        front = 1 - front;
        shown = image;
        setCredit(image);
        clearTimeout(fadeTimer);
        // The old picture stays under the new one until the fade is over, so
        // the change never dips through to the plain background.
        fadeTimer = setTimeout(() => old.classList.remove("on"), still ? 0 : FADE_MS + 100);
        prepareNextSoon();
      },
      (error) => {
        if (mine !== token || !running) return;
        loading = false;
        pendingId = null;
        console.warn("Frontpage: picture failed to load", error);
        failures += 1;
        if (failures < MAX_FAILURES) advance();
        else if (!shown) message("Couldn't load pictures; showing a plain background.");
      },
    );
  }

  function remember(image) {
    const state = readState();
    const recent = [...(state.recent ?? []).filter((id) => id !== image.id), image.id].slice(-RECENT);
    const next = state.next?.id === image.id ? null : state.next;
    writeState({ ...state, current: image, next, shownAt: Date.now(), recent, options });
  }

  /**
   * Moves on to a new picture: the preloaded one if it still fits, otherwise a
   * fresh pick. A call while one is already choosing joins that one.
   */
  function advance() {
    advancing ??= choose().finally(() => {
      advancing = null;
    });
    return advancing;
  }

  async function choose() {
    if (!running || !options) return;
    const state = readState();
    let image = acceptable(state.next) && state.next.id !== state.current?.id ? state.next : null;
    if (!image) {
      const pools = await readPools(options.categories);
      if (!running) return;
      image = pickNext(pools, options.categories, readState().recent ?? [], hidden);
    }
    if (!image) {
      if (!shown) message(filling ? "Loading pictures…" : "Couldn't load pictures; showing a plain background.");
      return;
    }
    remember(image);
    show(image);
  }

  // Picks the next picture and warms the HTTP cache with it, once the current
  // one has loaded, so the next change (or the next new tab) is instant.
  function prepareNextSoon() {
    clearTimeout(nextTimer);
    nextTimer = setTimeout(async () => {
      if (!running || !options || acceptable(readState().next)) return;
      const pools = await readPools(options.categories);
      const state = readState();
      if (!running || acceptable(state.next)) return;
      const next = pickNext(pools, options.categories, state.recent ?? [], hidden);
      if (!next) return;
      writeState({ ...state, next });
      const preload = new Image();
      preload.referrerPolicy = "no-referrer";
      preload.src = imageUrl(next, ...screenSize());
    }, 1500);
  }

  // Fetches the pools that are missing or stale, one category at a time.
  function fill() {
    if (filling || !options) return;
    const categories = options.categories.map(byId);
    filling = (async () => {
      for (const category of categories) {
        if (!running) return;
        if (!poolNeedsFetch(await getLocal(poolKey(category.id), null), category)) continue;
        const firstPicture = () => {
          if (running && !shown && !loading && !advancing) advance();
        };
        const pool = await refreshPool(category, firstPicture);
        if (pool?.images?.length) firstPicture();
        // Turned away (rate limit or outage): the others would be too. The
        // next check, a minute on, carries on.
        if (pool?.retryAt > Date.now()) return;
      }
    })()
      .catch((error) => console.warn("Frontpage: could not update the picture pools", error))
      .finally(() => {
        filling = null;
        if (running && !shown && !loading && !advancing) advance();
      });
  }

  function check(onLoad = false) {
    if (!running || !options) return;
    const state = readState();
    fill(); // first, so advance() knows whether pictures are on their way
    if (options.refresh === "tab" && !onLoad && shown) {
      // Every tab keeps the picture it opened with, unless it no longer fits the settings.
      if (!acceptable(shown)) advance();
      else prepareNextSoon();
    } else if (!acceptable(state.current) || isDue(state.shownAt, options.refresh, Date.now(), onLoad)) {
      advance();
    } else if (state.current.id !== shown?.id) {
      show(state.current); // on load, or another tab has moved on
    } else {
      prepareNextSoon();
    }
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") check();
  };

  function configure(next) {
    const normalised = normalise(next);
    const key = JSON.stringify(normalised);
    if (key === optionsKey) return;
    optionsKey = key;
    options = normalised;
    hidden = new Set(options.hidden);
    writeState({ ...readState(), options });
    if (!running) return;
    check(!checkedOnLoad);
    checkedOnLoad = true;
  }

  function start(nextMoving) {
    running = true;
    moving = nextMoving;
    instantUntil = performance.now() + 300;
    failures = 0;
    clearInterval(timer);
    timer = setInterval(onVisible, MINUTE);
    document.addEventListener("visibilitychange", onVisible);
    // Settings arrive a moment later; the options remembered from last time
    // let the right picture paint straight away, without a flash of the old one.
    const remembered = readState().options;
    if (!options && remembered) {
      options = normalise(remembered);
      hidden = new Set(options.hidden);
    }
    checkedOnLoad = Boolean(options);
    if (options) check(true);
  }

  function stop() {
    running = false;
    token += 1;
    loading = false;
    pendingId = null;
    clearInterval(timer);
    clearTimeout(fadeTimer);
    clearTimeout(nextTimer);
    document.removeEventListener("visibilitychange", onVisible);
    for (const img of imgs) {
      img.classList.remove("on", "top", "instant");
      img.removeAttribute("src");
    }
    shown = null;
    clearTimeout(creditTimer);
    if (credit) {
      credit.hidden = true;
      credit.classList.remove("shown");
    }
  }

  // A click on the picture itself, or on the empty page around the cards
  // (the layout lets those through to the body or the backdrop).
  document.addEventListener("click", (event) => {
    const { target } = event;
    if (!running || !shown || event.button !== 0) return;
    if (target === document.body || target === document.documentElement || root.contains(target)) revealCredit();
  });
  credit?.addEventListener("pointerleave", () => credit.classList.contains("shown") && concealCreditSoon());
  credit?.addEventListener("focusout", () => credit.classList.contains("shown") && concealCreditSoon());

  credit?.querySelector(".photo-next")?.addEventListener("click", () => {
    failures = 0;
    advance();
  });
  credit?.querySelector(".photo-hide")?.addEventListener("click", () => {
    if (!shown) return;
    const { id } = shown;
    hidden.add(id);
    // Saved once the next picture is chosen, so the settings round trip finds it in place.
    advance().then(() => onHide?.(id));
  });

  return { start, stop, configure };
}
