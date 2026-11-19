# AGENTS.md

Frontpage is a new tab and home page browser extension for Firefox and Chrome, and for Safari through a converted copy of the Chrome build. It is for the owner's personal use only and is never published to a store. [README.md](README.md) has the user-facing details, the file layout table and the dev harness. This file covers how to work on the project.

## Versioning (required)

**Every time you finish a feature or a fix, bump the version.** The version lives in three places, and all three must match:

- `extension/manifest.json` → `"version"`
- `package.json` → `"version"`
- `package-lock.json` → the top-level `"version"` and `packages[""].version`

Use semver (`MAJOR.MINOR.PATCH`):

| Bump | When | Examples |
|---|---|---|
| **PATCH** | A bug fix, or a small tweak to something that already exists | Fix the forecast's day labels across a DST change; adjust a colour; tighten a photo filter |
| **MINOR** | A new feature or option the user can see | A new background style, a new setting, a new photo category, a new widget |
| **MAJOR** | A change that breaks what's already there | Stored settings or notes change shape and old values would be lost or misread; a feature is removed; a new permission is added to `manifest.json` (Firefox asks the user to approve it again) |

Rules:

- Bump once for each finished feature or fix, not on every edit along the way. If one task contains several changes, use the largest bump that applies.
- Don't bump for changes that never reach the extension: `dev/`, `README.md`, `AGENTS.md`, `.gitignore`, devDependencies.
- The fastest way to bump: `npm version patch --no-git-tag-version` (or `minor`/`major`) updates `package.json` and `package-lock.json`. Then copy the new number into `extension/manifest.json` by hand.
- Mozilla won't sign a version it has already signed, so every build that is signed must have a new number.
- `dist/chrome/manifest.json` is generated from `extension/manifest.json`. Never edit it.
- When you report back after the work, include the old and new version numbers.

## Ground rules

- **No build step and no runtime dependencies.** `extension/` is the Firefox extension exactly as it ships. Only use plain ES modules, CSS and HTML. Don't add a bundler, a framework, TypeScript or npm packages to the page. The only devDependencies are `web-ext` and Aqueduct (for Safari). Aqueduct is pinned to an exact version because a scheduled job runs it unattended: read its changes before you move the pin.
- **One source tree, two browsers.** `extension/manifest.json` is Firefox's manifest. [dev/build.mjs](dev/build.mjs) copies `extension/` to `dist/chrome/` and rewrites the manifest for Chrome: it drops the homepage override and `browser_specific_settings`, switches to the PNG icons, and sets `minimum_chrome_version`. If a manifest change needs to be different on Chrome, make that change in `build.mjs`. Safari is built from `dist/chrome`; anything Safari needs differently goes in the Aqueduct arguments in `dev/safari.mjs`. Don't fork the page code.
- **Use `browser.*`, never `chrome.*`.** Chrome 148+ supports the `browser` namespace. Where the browsers behave differently (e.g. finding the bookmarks toolbar in `bookmarks.js`), test which API or data is present. Don't sniff the user agent.
- **Safari.** [dev/safari.mjs](dev/safari.mjs) has Aqueduct convert `dist/chrome`, sign it with the owner's free Apple team and install it into `~/Applications/Frontpage.app`. A LaunchAgent (`com.nullgreg.frontpage.safari-renew`) runs `renew` hourly. It rebuilds the snapshot in `dist/safari/source`, never the working tree: when the signature has under 72 hours left, or at once if the signature stops verifying or Safari stops listing the extension. The owner won't re-sign by hand and has no paid developer account, so keep it automatic. Things learned the hard way:
  - **The page has to cope with what Safari lacks**, because it's built with `--no-shim`. Aqueduct's shim would add ~540 KB to every new tab, and its `storage.sync` stand-in would make `setSynced` delete what it just saved. There is no `browser.bookmarks`: the toolbar comes from a Firefox JSON backup imported in settings (`bookmarks-import.js`). `storage.sync` doesn't sync. Test for the API, as `hasBookmarksApi()` does.
  - **Don't assume a provisioning profile.** Xcode signed the first real install with the team but embedded no profile. The expiry is therefore the earlier of the signing certificate and any profile, and the health check covers a drop no date predicts.
  - **Never let Aqueduct fall back to ad-hoc signing.** Renewals pass the installed app's team id rather than `auto`, so Aqueduct fails instead. `install` checks the Xcode licence and for a valid Apple Development certificate first. A certificate that exists but isn't valid usually means the WWDR G3 intermediate is missing (see README).
  - **The agent starts a launcher, not node.** System Settings names a background item after the program it starts, and plain `node` meant nothing. `schedule` writes `~/Library/Application Support/Frontpage/Frontpage Safari Renewal`, a shell script that explains itself, and `unschedule` removes it.
  - **The host app doesn't need to run.** Aqueduct launches it so that Safari registers the extension, then leaves it in the Dock, so `build()` quits it once pluginkit lists the extension.
  - **Don't pass `--verify`.** It launches Safari, and fails any first install, because the extension isn't turned on yet.
  - **Never change the bundle id** (`com.nullgreg.frontpage`). Safari would treat it as a new extension and leave the old storage behind.
- **Privacy.** The page talks only to Open-Meteo, Wikimedia Commons, the Art Institute of Chicago and the user's own bookmarked sites (for favicons). Send requests to third parties with `referrerPolicy: "no-referrer"` and `credentials: "omit"`, as `photos.js` does. Don't add analytics, telemetry or new services without asking. Any new network contact also goes in the README's "Good to know" section.
- **Storage.** Use the helpers in [store.js](extension/page/store.js). Settings and notes go in `storage.sync`, which allows about 8 KB per item, and fall back to local storage when a value is too big. Keep synced values small. Lists that grow get capped, e.g. hidden photos are capped at 300. New settings need a default in `DEFAULTS` in [settings.js](extension/page/settings.js), and the code must still work when an older stored settings object lacks the new key.
- **Motion.** Animated work must respect both the "Animate background" setting and `prefers-reduced-motion`. See `background.js`.

## Code style

- 2-space indentation, double quotes, semicolons. Use ES modules with named exports. Put shared DOM helpers in `dom.js` and canvas helpers in `canvas-util.js`.
- Write comments that explain *why* (a browser quirk, a quota, an API limit), not *what*. Each file starts with a short header comment saying what it is for.
- Keep logic that can be tested in pure, exported functions that don't touch the DOM or `browser.*` at import time. That lets `dev/check.mjs` import them under Node.
- User-facing text and the README use plain, friendly prose and British spelling ("colour", "favourite").

## Checking your work

Run these before you call a change done:

```sh
node dev/check.mjs      # unit checks on the pure functions; non-zero exit on failure
npm run lint            # Mozilla's validator on extension/
npm run build:chrome    # also fails if the Chrome description goes over 132 characters
```

- `check.mjs` prints a "Reparsing as ES module" warning. That's expected. Add checks there for new pure logic.
- To see a change, take a screenshot with `dev/shoot.sh NAME 'QUERY' [W,H]`, which writes `dev/out/NAME.png`, and look at the PNG. The query parameters are documented at the top of [dev/shim.js](dev/shim.js). When you add a feature that has a visible state, add a shim parameter for it and document it there. Headless Firefox doesn't render `backdrop-filter`. `shoot.sh` needs `timeout` on the PATH, which macOS lacks (coreutils provides it). Use the `safari` parameter to see the page without a bookmarks API.
- Safari can't be driven from here. `node dev/safari.mjs status` and `node dev/safari.mjs renew` (without `--force`) only read and log, so they're safe to run. `install`, `renew --force`, `schedule` and `unschedule` change the owner's Mac (the app in `~/Applications`, the LaunchAgent), so ask first.
- Photos use the fixtures in `dev/fixtures/` unless you pass `livephotos`. Don't hit the live APIs in a loop: Commons turns away bursts of requests.

## Docs

When behaviour, settings, network contact or files change, update [README.md](README.md) in the same change. That includes the Layout table when you add or rename a file.

## Don't

- Edit `dist/`, `web-ext-artifacts/` or `dev/out/`. They're generated.
- Commit `.env`. It holds the AMO signing keys. Don't run `npm run sign` unless asked.
- Commit or push unless asked.
