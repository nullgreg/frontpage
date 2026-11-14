# frontpage

A dark-glass new tab and home page for Firefox, built as a small extension.

- **Toolbar bookmarks by folder.** Each folder on the bookmarks toolbar is a card; subfolders are sub-headings inside it; loose toolbar bookmarks go in a "Toolbar" card. The page reads the toolbar live and updates as you add, move, rename or delete bookmarks.
- **Search.** Type to filter bookmarks; Enter opens the highlighted one (Ctrl+Enter in a new tab), arrow keys move the highlight. If nothing matches, Enter opens the address or searches the web.
- **Clock, date and weather.** Weather comes from [Open-Meteo](https://open-meteo.com) (no account or API key) for a city you pick in settings, with an optional 7-day forecast: a row per day with its weather, low and high, and a bar showing where that range sits in the week, coloured by temperature (the dot on today's bar is the temperature now; hover a day for the chance of rain).
- **Notes and to-dos.** A slide-out scratchpad saved through Firefox Sync.
- **Backgrounds.** Nine styles to pick from in settings: drifting colour glows (Aurora, Ember, Lagoon), Daylight (colours follow the time of day), animated Starfield, Waves, Constellation and Sky scenes, and a still Midnight. Animation can be switched off.
- **Weather effects and the Sky style.** With a weather city set, the background follows the weather there, subtly: faint rain, drizzle, snow, fog or haze over whichever style is chosen, dim lightning in storms, the glow styles shift colour with the mood, wind sets the pace and height of Waves, and cloud hides stars in Starfield. Sky depicts the sky over that city outright: time of day, sun or moon, stars and drifting clouds, with the same rain or snow on top. One switch in settings turns the effects off; Sky always shows the weather.
- **Silly jokes.** About 600 dad jokes, a different one on every new tab. The setup shows first and the punchline fades in five seconds later; click to skip the wait, click again for another joke. Give it a name in settings and the jokes are addressed to that person ("Hey Gertrude, …", "Psst, Gertrude: …"). You can add jokes of your own, and switch on an extra set of programming and science jokes.

No build step and no runtime dependencies: the extension is the plain files in [extension/](extension/).

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

## Settings

The sliders button in the top right opens settings: weather city, 7-day forecast on/off, temperature unit, 12/24-hour clock, web search engine, background style, animation and weather effects, site icons on/off, and the joke options (on/off, nerdy jokes, the name they are addressed to, your own jokes). Settings and notes sync between your machines through Firefox Sync.

## Good to know

- **Focus on new tabs.** Firefox keeps the cursor in the address bar on a new tab and extensions can't move it. Click the search box or press Tab first. When the page opens as your home page, the search box is focused automatically and typing anywhere jumps to it.
- **Site icons.** Firefox doesn't let extensions read its saved favicons, so each bookmark shows a coloured letter tile that is replaced by the site's own `/favicon.ico` when one loads. That means the page contacts your bookmarked sites (and nobody else) for icons. Turn off "Show site icons" to stop that.
- **Your own jokes.** One per line in settings. Put `|` where the pause goes (`Why did Barnaby cross the road? | To borrow my ladder again.`); without one, the last sentence becomes the punchline. They are shown exactly as written (no name is added) and each comes up about ten times as often as a built-in joke.
- **Weather effects.** They need a weather city (the switch is greyed out without one) and follow the weather there with up to 15 minutes' delay, since that is how often the reading is refreshed; a reading more than two hours old, as after a long time offline, produces no effects. With animation off, or when the OS asks for reduced motion, the colour tints, haze and fog still show but nothing falls and nothing flashes. Sky always shows the weather, whatever the switch says.
- **Notes size.** Firefox Sync allows about 8 KB per item. Longer notes are still saved, but only on the current machine; the panel says so when that happens.
- **Skipped bookmarks.** Bookmarklets (`javascript:`) and smart-folder queries (`place:`) can't be opened from a page, so they are left out.

## Layout

| Path | What it is |
|---|---|
| `extension/manifest.json` | Extension manifest: new tab and home page overrides, `bookmarks` and `storage` permissions |
| `extension/page/app.js` | Entry point: clock, and wiring for everything below |
| `extension/page/bookmarks.js` | Reads and watches the toolbar; renders the card grid |
| `extension/page/search.js` | Bookmark filter and web-search fallback |
| `extension/page/weather.js` | Open-Meteo lookup, 15-minute cache, weather chip and 7-day forecast list |
| `extension/page/notes.js` | Notes and to-do panel |
| `extension/page/background.js` | Background styles: catalogue, glow palettes and weather tint, Starfield, Waves and Constellation scenes, controller |
| `extension/page/canvas-util.js` | Helpers shared by the canvas scenes: gradients, glows, clamp, RGB mixing, easing |
| `extension/page/weather-layer.js` | Weather drawn over any style: rain and drizzle streaks, snow, fog, haze, lightning |
| `extension/page/sky.js` | The Sky style: sky colour by time of day, sun, moon, stars, clouds |
| `extension/page/jokes.js` | Joke widget: shuffled decks, punchline timing, name openers, parsing of your own jokes |
| `extension/page/jokes-data.js` | The built-in jokes, as setup and punchline pairs |
| `extension/page/settings.js` | Settings dialog |
| `extension/page/store.js` | Storage helpers (synced with local fallback) |

`npm run lint` checks the extension with Mozilla's validator.

## Developing

The page needs the `browser.*` APIs and a weather reading, so it cannot simply be opened from disk. `dev/` holds a preview harness (not part of the extension; `web-ext` only packages `extension/`):

```sh
dev/shoot.sh base ''                       # screenshot -> dev/out/base.png
dev/shoot.sh stars 'bg=starfield&wx=rain'  # URL parameters pick the scenario
dev/shoot.sh dialog 'settings' 1440,1300   # optional WIDTH,HEIGHT
node dev/check.mjs                         # checks on the pure functions
```

`shoot.sh` starts `dev/serve.py`, renders the page in headless Firefox with fake bookmarks, in-memory storage and scripted weather (`dev/shim.js`), and writes one PNG. The parameters it understands (`bg`, `still`, `wx`, `code`, `wind`, `cloud`, `sun`, `settings`, `notes`, `q`, `wait`, …) are listed at the top of `dev/shim.js`. `node dev/check.mjs` prints a "Reparsing as ES module" warning; that is expected.
