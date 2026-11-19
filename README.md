# frontpage

A dark-glass new tab and home page for Firefox, Chrome and Safari, built as a small extension.

- **Toolbar bookmarks by folder.** Each folder on the bookmarks toolbar is a card; subfolders are sub-headings inside it; loose toolbar bookmarks go in a "Toolbar" card. The page reads the toolbar live and updates as you add, move, rename or delete bookmarks. Safari doesn't let extensions read its bookmarks, so there the cards come from a Firefox bookmarks backup you import (see [Safari](#safari)).
- **Search.** Type to filter bookmarks; Enter opens the highlighted one (Ctrl+Enter in a new tab), arrow keys move the highlight. If nothing matches, Enter opens the address or searches the web.
- **Clock, date and weather.** Weather comes from [Open-Meteo](https://open-meteo.com) (no account or API key) for a city you pick in settings, with an optional 7-day forecast: a row per day with its weather, low and high, and a bar showing where that range sits in the week, coloured by temperature (the dot on today's bar is the temperature now; hover a day for the chance of rain).
- **Notes and to-dos.** A slide-out scratchpad saved through Firefox Sync or Chrome Sync (in Safari, kept on the Mac).
- **Backgrounds.** Ten styles to pick from in settings: drifting colour glows (Aurora, Ember, Lagoon), Daylight (colours follow the time of day), animated Starfield, Waves, Constellation and Sky scenes, Photos, and a still Midnight. Animation can be switched off.
- **Photos.** High-quality pictures from [Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Featured_pictures) featured pictures and the [Art Institute of Chicago](https://www.artic.edu/open-access/public-api)'s public-domain collection (no account or key). Tick any mix of Space, Landscapes, Seascapes, Animals, Cities & architecture, Mountains & forests, Flowers & plants and Earth from above, and the art styles Impressionist, Old Masters, Japanese prints and Asian ink painting. A new picture comes with every new tab, every 15 minutes, every hour or every day. Click the background and its credit fades in at the bottom right for a few seconds, with buttons for the next picture and for never showing this one again.
- **Weather effects and the Sky style.** With a weather city set, the background follows the weather there, subtly: faint rain, drizzle, snow, fog or haze over whichever style is chosen, dim lightning in storms, the glow styles shift colour with the mood, wind sets the pace and height of Waves, and cloud hides stars in Starfield. Sky depicts the sky over that city outright: time of day, sun or moon, stars and drifting clouds, with the same rain or snow on top. One switch in settings turns the effects off; Sky always shows the weather.
- **Silly jokes.** About 600 dad jokes, a different one on every new tab. The setup shows first and the punchline fades in five seconds later; click to skip the wait, click again for another joke. Give it a name in settings and the jokes are addressed to that person ("Hey Gertrude, …", "Psst, Gertrude: …"). You can add jokes of your own, and switch on an extra set of programming and science jokes.

No build step and no runtime dependencies: the extension is the plain files in [extension/](extension/). Chrome gets a copy of the same files with its own manifest (see [Chrome](#chrome)), and Safari gets the Chrome copy converted into a Mac app (see [Safari](#safari)).

## Try it

Needs Node 20.6 or newer and Firefox 142 or newer.

```sh
npm install
npm start        # opens a throwaway Firefox profile with the extension loaded
```

To try it against your real bookmarks without signing: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and pick `extension/manifest.json`. Firefox removes temporary add-ons when it restarts.

## Install permanently

Release Firefox only keeps signed extensions. Signing as an *unlisted* add-on is free and keeps it private (it never appears on addons.mozilla.org).

1. Sign in at <https://addons.mozilla.org/developers/addon/api/key/> and generate API credentials.
2. Copy `.env.example` to `.env` and fill in the two values. `.env` is git-ignored.
3. Run `npm run sign`. After Mozilla's automated checks (usually a minute or two) the signed `.xpi` lands in `web-ext-artifacts/`.
4. In Firefox open `about:addons`, click the gear, choose **Install Add-on From File…** and pick the `.xpi`.
5. Firefox asks to confirm the new tab and home page change the first time each is shown. Keep the change.

To update: bump `version` in [extension/manifest.json](extension/manifest.json) (Mozilla rejects a version it has already signed), run `npm run sign` again and install the new `.xpi` over the old one.

## Chrome

Needs Chrome 148 or newer (the first with the `browser.*` namespace the page uses).

```sh
npm run build:chrome   # copies extension/ to dist/chrome/ with a Chrome manifest
npm run start:chrome   # or: build, then open a throwaway Chrome profile with it loaded
```

To install it in your own Chrome:

1. Run `npm run build:chrome`.
2. Open `chrome://extensions`, switch on **Developer mode** (top right), click **Load unpacked** and pick the `dist/chrome` folder. An unpacked extension stays installed across restarts, with no signing needed.
3. Open a new tab. Chrome asks whether to keep the changed new tab page. Keep it.

To update: run `npm run build:chrome` again and click the reload arrow on Frontpage's card in `chrome://extensions`. Don't edit `dist/chrome`; it's rebuilt from `extension/` each time.

Differences from Firefox:

- **No home page override.** Chrome only accepts a web address there. To use Frontpage as the home page, copy its address from a new tab (`chrome-extension://…/page/index.html`) into Settings → Appearance → Show home button, or into On startup → Open a specific page.
- **Bookmarks bar.** The cards come from Chrome's bookmarks bar. If Chrome keeps both bookmarks on this device and bookmarks saved to your Google account, the contents of both bars are shown, in the order Chrome lists them.
- **Sync.** Settings and notes go through Chrome Sync when you're signed in to Chrome. With sync off they stay on the machine.

## Safari

Safari only keeps an extension you build yourself if an Apple developer team has signed it. With a free Apple ID that signature can run out after 7 days. [Aqueduct](https://github.com/magicelk235/Aqueduct) (a devDependency) converts the Chrome build for Safari, signs it with your free team and installs it into `~/Applications`. [dev/safari.mjs](dev/safari.mjs) wraps it, and a LaunchAgent re-signs Frontpage before the signature runs out.

Needs the full Xcode app (not just the Command Line Tools) and a free Apple ID.

### Set up

1. Install Xcode from the App Store. Open it once and agree to the licence.
2. In Xcode → Settings → Accounts, add your Apple ID. Select it, choose **Manage Certificates…**, click **+** and pick **Apple Development**.
3. Run `npm install`, then `npm run safari:install`. If macOS asks whether `codesign` may use a key in your keychain, choose **Always Allow**.
4. In Safari → Settings → Extensions, turn on Frontpage. Then choose it for new windows and new tabs (Safari → Settings → General).
5. Bring your bookmarks over (below).
6. Run `npm run safari:schedule` to keep it signed. Then, while you're at the Mac, run `launchctl kickstart -k gui/$(id -u)/com.nullgreg.frontpage.safari-renew` once, so you can answer anything it asks the first time.

`safari:install` stops before building, and says why, if Xcode's licence hasn't been accepted or there's no usable Apple Development certificate. See [If something goes wrong](#if-something-goes-wrong).

### Bookmarks

Safari doesn't let extensions read its bookmarks, so Frontpage shows your Firefox toolbar instead. In Firefox, choose Bookmarks → Manage Bookmarks → Import and Backup → **Backup…** and save the `.json` file. Then, in Frontpage's settings, choose **Import from Firefox…** and pick it. The toolbar's folders become cards, as in Firefox. Import again whenever you change the toolbar. It has to be the JSON backup: Export Bookmarks to HTML won't do.

### Staying signed

A signature runs out when either of two things does. One is the provisioning profile, which lasts about 7 days on a free team. The other is the signing certificate, which lasts a year. Xcode leaves the profile out when nothing in the app needs one, and then only the certificate counts. `npm run safari:status` shows which applies to your copy.

The LaunchAgent runs a check every hour and at login:

- If the signature no longer verifies, or Safari no longer lists Frontpage, it rebuilds straight away. That repairs a drop the dates didn't predict within the hour.
- Otherwise it does nothing until the signature has less than 3 days left.
- A rebuild re-signs `dist/safari/source`, the copy `safari:install` made, so unfinished edits in the working tree never reach Safari. It takes a minute or two, and an open Frontpage tab may reload.
- If Apple hands back the profile it already gave rather than a fresh one, the next rebuild waits until that one runs out.

A check that finds nothing to do takes about a tenth of a second and then exits; nothing stays running in between. launchd doesn't wake the Mac for it: a check missed while it slept runs on waking. Rebuilds run as a low-priority background job. If the Mac is off for longer than the signature lasts, Frontpage drops out of Safari until the next login renews it.

If a rebuild fails, macOS shows a notification (at most every 12 hours) and the check tries again 3 hours later. Run `npm run safari:renew` to see why. Most often Xcode wants you to sign in again.

- `npm run safari:status` shows what's installed, when its signature runs out and why, whether Safari lists it, and how the last build went.
- `npm run safari:renew -- --force` rebuilds now.
- The Frontpage app in `~/Applications` only carries the extension; Safari runs Frontpage without it. An install or rebuild opens the app briefly so that Safari picks up the new build, then quits it. Don't delete the app: that removes Frontpage from Safari.
- The log is `~/Library/Logs/Frontpage/safari-renew.log`, one line per check.
- In System Settings → General → Login Items & Extensions, the job is listed as **Frontpage Safari Renewal**. That is a small launcher in `~/Library/Application Support/Frontpage/` that starts the check; open it in a text editor to see what it's for and how to remove it.
- To put your changes into Safari, run `npm run safari:install` again. It keeps the same bundle id, so Safari treats it as an update rather than a new extension.
- To remove it: `npm run safari:unschedule`, then `npx aqueduct --uninstall Frontpage`.

### If something goes wrong

- **"Xcode's licence hasn't been accepted yet."** Open Xcode once and agree, or run `sudo xcodebuild -license accept`.
- **"There's no Apple Development certificate yet."** Create one: Xcode → Settings → Accounts → your Apple ID → Manage Certificates… → + → Apple Development.
- **"Your Apple Development certificate is there, but macOS can't verify it."** The keychain is missing Apple's current intermediate certificate (WWDR G3); a keychain set up years ago may only have the one that expired in 2023. Install it, then run `safari:install` again:
  ```sh
  curl -fsSLo /tmp/AppleWWDRCAG3.cer https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer
  security add-certificates -k ~/Library/Keychains/login.keychain-db /tmp/AppleWWDRCAG3.cer
  security find-identity -v -p codesigning   # should now list it
  ```
- **"The new build isn't team-signed."** Aqueduct couldn't find your team and fell back to ad-hoc signing, which Safari only keeps until it quits. Check the account and certificate in Xcode, then install again.
- **Frontpage vanished from Safari.** Run `npm run safari:status`, then `npm run safari:renew -- --force`.

Differences from Firefox:

- **No sync.** Safari doesn't sync extension storage, so settings and notes stay on the Mac.
- **Bookmarks** are a copy of your Firefox toolbar as it was at the last import.
- **No home page override.** Choose Frontpage for new windows instead.
- **Signing contacts Apple**, through Xcode. The page itself contacts no one new.

## Settings

The sliders button in the top right opens settings: weather city, 7-day forecast on/off, temperature unit, 12/24-hour clock, web search engine, background style (for Photos also the categories and how often the picture changes), animation and weather effects, site icons on/off, and the joke options (on/off, nerdy jokes, the name they are addressed to, your own jokes). In Safari they start with importing your bookmarks toolbar from a Firefox backup. Settings and notes sync between your machines through Firefox Sync (or Chrome Sync); Safari keeps them on the Mac.

## Good to know

- **Focus on new tabs.** Firefox and Chrome keep the cursor in the address bar on a new tab and extensions can't move it. Click the search box or press Tab first. When the page opens as your home page, the search box is focused automatically and typing anywhere jumps to it.
- **Site icons.** Firefox doesn't let extensions read its saved favicons, so each bookmark shows a coloured letter tile that is replaced by the site's own `/favicon.ico` when one loads. That means the page contacts your bookmarked sites (and nobody else) for icons. Turn off "Show site icons" to stop that.
- **Your own jokes.** One per line in settings. Put `|` where the pause goes (`Why did Barnaby cross the road? | To borrow my ladder again.`); without one, the last sentence becomes the punchline. They are shown exactly as written (no name is added) and each comes up about ten times as often as a built-in joke.
- **Weather effects.** They need a weather city (the switch is greyed out without one) and follow the weather there with up to 15 minutes' delay, since that is how often the reading is refreshed; a reading more than two hours old, as after a long time offline, produces no effects. With animation off, or when the OS asks for reduced motion, the colour tints, haze and fog still show but nothing falls and nothing flashes. Sky always shows the weather, whatever the switch says.
- **Photos.** The Photos style contacts Wikimedia Commons (`commons.wikimedia.org`, pictures from `upload.wikimedia.org` and `thumb.wikimedia.org`) and the Art Institute of Chicago (`api.artic.edu`, pictures from `www.artic.edu`), with no cookies or referrer. Commons turns away bursts of requests, so each ticked category keeps a list of candidates that is refreshed with a new random selection once a week; that is a handful of requests per category per week. The next picture is loaded ahead of time, so a new tab shows its picture straight away. "Every day" changes at midnight. With "every new tab", a tab keeps its picture until it is closed. Pictures are chosen to suit a background: wide, at least 1900 pixels across, and with titles that suggest nudity, death or disaster left out. "Don't show this again" covers anything that gets through, and remembers the last 300 pictures you hid. Without a connection, the first time, the page shows a plain dark background and says so in the corner.
- **Notes size.** Firefox Sync and Chrome Sync allow about 8 KB per item. Longer notes are still saved, but only on the current machine; the panel says so when that happens.
- **Skipped bookmarks.** Bookmarklets (`javascript:`) and smart-folder queries (`place:`) can't be opened from a page, so they are left out.

## Layout

| Path | What it is |
|---|---|
| `extension/manifest.json` | Extension manifest (Firefox's): new tab and home page overrides, `bookmarks` and `storage` permissions |
| `extension/icons/` | The icon as SVG (Firefox, page favicon) and as 16–128 px PNGs (Chrome) |
| `dev/build.mjs` | Builds `dist/chrome/`: copies `extension/` and rewrites the manifest for Chrome |
| `dev/safari.mjs` | Safari: converts the Chrome build with Aqueduct, signs and installs it, and renews the signature from a LaunchAgent |
| `extension/page/app.js` | Entry point: clock, and wiring for everything below |
| `extension/page/bookmarks.js` | Finds the toolbar (Firefox), the bookmarks bar (Chrome) or the imported toolbar (Safari), reads and watches it; renders the card grid |
| `extension/page/bookmarks-import.js` | Reads the toolbar from a Firefox bookmarks backup, for Safari, which has no bookmarks API |
| `extension/page/search.js` | Bookmark filter and web-search fallback |
| `extension/page/weather.js` | Open-Meteo lookup, 15-minute cache, weather chip and 7-day forecast list |
| `extension/page/notes.js` | Notes and to-do panel |
| `extension/page/background.js` | Background styles: catalogue, glow palettes and weather tint, Starfield, Waves and Constellation scenes, controller |
| `extension/page/canvas-util.js` | Helpers shared by the canvas scenes: gradients, glows, clamp, RGB mixing, easing |
| `extension/page/weather-layer.js` | Weather drawn over any style: rain and drizzle streaks, snow, fog, haze, lightning |
| `extension/page/sky.js` | The Sky style: sky colour by time of day, sun, moon, stars, clouds |
| `extension/page/photos.js` | The Photos style: categories and their queries, Commons and Art Institute lookups, weekly pools, choosing, preloading, crossfade and credit |
| `extension/page/jokes.js` | Joke widget: shuffled decks, punchline timing, name openers, parsing of your own jokes |
| `extension/page/jokes-data.js` | The built-in jokes, as setup and punchline pairs |
| `extension/page/settings.js` | Settings dialog |
| `extension/page/store.js` | Storage helpers (synced with local fallback) |

`npm run lint` checks the extension with Mozilla's validator (Firefox build only).

## Developing

The page needs the `browser.*` APIs and a weather reading, so it cannot simply be opened from disk. `dev/` holds a preview harness (not part of the extension; `web-ext` only packages `extension/`):

```sh
dev/shoot.sh base ''                       # screenshot -> dev/out/base.png
dev/shoot.sh stars 'bg=starfield&wx=rain'  # URL parameters pick the scenario
dev/shoot.sh dialog 'settings' 1440,1300   # optional WIDTH,HEIGHT
node dev/check.mjs                         # checks on the pure functions
node dev/photo-pools.mjs [CATEGORY…]       # live: how many usable pictures each Photos category finds
```

`shoot.sh` starts `dev/serve.py`, renders the page in headless Firefox with fake bookmarks, in-memory storage and scripted weather (`dev/shim.js`), and writes one PNG. The parameters it understands (`bg`, `still`, `wx`, `code`, `wind`, `cloud`, `sun`, `photos`, `refresh`, `livephotos`, `safari`, `imported`, `settings`, `notes`, `q`, `wait`, `warnings`, …) are listed at the top of `dev/shim.js`. Photos are served from stand-ins in `dev/fixtures/` unless `livephotos` is given. Headless screenshots don't render `backdrop-filter`, so cards over a photo look less blurred there than in Firefox. It needs `firefox` and `timeout` on your PATH; macOS has no `timeout`, so install coreutils (`brew install coreutils`) and put its `gnubin` directory on your PATH. Use `safari` (and `imported`) to see the page as Safari shows it, without a bookmarks API. `node dev/check.mjs` prints a "Reparsing as ES module" warning; that is expected.
