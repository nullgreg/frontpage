// Live report on the Photos categories: runs each category's real queries
// against Wikimedia Commons and the Art Institute of Chicago and prints how
// many results came back, how many survive the filters, and a few titles.
//
//   node dev/photo-pools.mjs              every category
//   node dev/photo-pools.mjs space aerial just these
//
// Requests to Commons are spaced 4 s apart (photos.js does that itself), so
// a full run takes a minute or so. Node prints a "Reparsing as ES module"
// warning; that is expected.
const { PHOTO_CATEGORIES, fetchCategoryImages, imageUrl } = await import(
  new URL("../extension/page/photos.js", import.meta.url)
);

const wanted = process.argv.slice(2);
const categories = wanted.length ? PHOTO_CATEGORIES.filter((c) => wanted.includes(c.id)) : PHOTO_CATEGORIES;
const unknown = wanted.filter((id) => !PHOTO_CATEGORIES.some((c) => c.id === id));
if (unknown.length) console.error(`Unknown categories: ${unknown.join(", ")}`);

// Wikimedia asks scripts to identify themselves; browsers send their own User-Agent.
const politeFetch = (url, init = {}) =>
  fetch(url, { ...init, headers: { ...init.headers, "User-Agent": "frontpage-dev-pool-report/1.0" } });

let short = 0;
for (const category of categories) {
  try {
    const { images, raw, pages } = await fetchCategoryImages(category, { fetch: politeFetch });
    const flag = images.length < 40 ? "  <-- under 40" : "";
    if (flag) short += 1;
    console.log(`\n${category.id} (${category.name}): ${raw} results, ${images.length} usable${pages > 1 ? `, ${pages} pages` : ""}${flag}`);
    for (const image of images.slice(0, 5)) {
      console.log(`  ${image.width}x${image.height}  ${image.title.slice(0, 70)}  | ${image.artist.slice(0, 40)} | ${image.license}`);
    }
    if (images[0]) console.log(`  1920: ${imageUrl(images[0], 1920)}\n  3840: ${imageUrl(images[0], 3840)}`);
  } catch (error) {
    short += 1;
    console.log(`\n${category.id}: FAILED ${error.message}`);
  }
}
console.log(`\n${categories.length - short} of ${categories.length} categories have 40 or more usable pictures.`);
