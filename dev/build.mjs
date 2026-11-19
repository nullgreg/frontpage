// Builds the Chrome version of the extension into dist/chrome/. Run: node dev/build.mjs
//
// extension/ stays the Firefox extension, loaded and signed as it is. Chrome
// needs only a different manifest; the page files are copied unchanged.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = `${root}extension`;
const out = `${root}dist/chrome`;

rmSync(out, { recursive: true, force: true });
cpSync(source, out, {
  recursive: true,
  // web-ext's record of the last Firefox signing upload; nothing to do with Chrome.
  filter: (path) => !path.endsWith(".amo-upload-uuid"),
});

const manifest = JSON.parse(readFileSync(`${source}/manifest.json`, "utf8"));

// Chrome won't load a relative homepage (it wants an absolute URL), so the
// home page is left to the user; see the README.
delete manifest.chrome_settings_overrides;
// Firefox-only; Chrome would only warn about it.
delete manifest.browser_specific_settings;
manifest.description = manifest.description.replace("new tab and home page", "new tab page");
// The first version that answers to browser.* as well as chrome.*.
manifest.minimum_chrome_version = "148";
// Chrome does not accept SVG icons.
manifest.icons = Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/icon-${size}.png`]));

if (manifest.description.length > 132) {
  throw new Error(`description is ${manifest.description.length} characters; Chrome allows 132`);
}

writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("dist/chrome");
