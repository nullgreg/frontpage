// Frontpage for Safari: builds it with Aqueduct, installs it and keeps it
// signed. Run: node dev/safari.mjs COMMAND, or the npm scripts safari:*.
//
//   install     build from the working tree, sign with your Xcode team, install
//   renew       re-sign the installed copy if its signature runs out within
//               72 hours (--force: now); the LaunchAgent runs this every hour
//   status      what's installed, when its signature runs out, the last renewal
//   schedule    start the LaunchAgent (every hour, and at login)
//   unschedule  stop it
//
// Safari only keeps an extension you build yourself if it is signed by an
// Apple developer team, and a free Apple ID's provisioning profile lasts about
// 7 days, hence the renewals. They rebuild dist/safari/source, the copy that
// `install` made, so half-finished edits in the working tree never reach
// Safari. Aqueduct needs the full Xcode app, not just the Command Line Tools.
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Never change it: Safari would see a different extension, and the old one's
// storage (settings, notes, imported bookmarks) would be left behind.
export const BUNDLE_ID = "com.nullgreg.frontpage";
export const LABEL = "com.nullgreg.frontpage.safari-renew";
const APP_NAME = "Frontpage";
const SNAPSHOT = join(root, "dist/safari/source");
const BUILD = join(root, "dist/safari/build");
const STATE = join(root, "dist/safari/renew-state.json");
const APP = join(homedir(), "Applications", `${APP_NAME}.app`);
const AGENT = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
// System Settings → General → Login Items names a background item after the
// program it starts. Starting node directly showed up as just "node", so the
// agent starts this launcher instead, and its file name is what shows there.
const LAUNCHER = join(homedir(), "Library/Application Support/Frontpage", "Frontpage Safari Renewal");
const LOG = join(homedir(), "Library/Logs/Frontpage/safari-renew.log");
const XCODE = "/Applications/Xcode.app/Contents/Developer";
// Where Xcode keeps the provisioning profiles it fetches: newer Xcode, then older.
const PROFILE_DIRS = [
  join(homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles"),
  join(homedir(), "Library/MobileDevice/Provisioning Profiles"),
];

const HOUR = 3600_000;
export const RENEW_WITHIN = 72 * HOUR;
// A failure usually needs a person (Xcode wants a sign-in), so don't rebuild every hour meanwhile.
const RETRY_AFTER_FAILURE = 3 * HOUR;
const NOTIFY_EVERY = 12 * HOUR;

// ----- pure helpers (checked by dev/check.mjs) -----

/** A <date> or <string> value from XML plist text, or null. Enough for provisioning profiles. */
export function plistValue(xml, key) {
  const name = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<key>${name}</key>\\s*<(?:date|string)>([^<]*)</(?:date|string)>`).exec(xml);
  return match ? match[1] : null;
}

/** When a decoded provisioning profile runs out (ms), or null. */
export function profileExpiry(xml) {
  const time = Date.parse(plistValue(xml, "ExpirationDate") ?? "");
  return Number.isFinite(time) ? time : null;
}

/** The bundle id a decoded profile is for ("TEAMID.com.example.app" gives "com.example.app"), or null. */
export function profileBundleId(xml) {
  const appId = plistValue(xml, "com.apple.application-identifier") ?? plistValue(xml, "application-identifier");
  return appId ? appId.slice(appId.indexOf(".") + 1) : null;
}

/** A time for logs and messages, e.g. "25 Nov 2026, 21:05". */
export function stamp(time) {
  return new Date(time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Whether `renew` should rebuild now, and why. `expiresAt` is when the
 * installed signature runs out, or null if the installed copy isn't team-signed.
 * `healthy` is false when the signature no longer verifies or Safari no longer
 * lists the extension. `waitUntil` is set when a renewal got back the profile it
 * already had, and `retryAfter` after a failure.
 */
export function renewalDue({ installed, expiresAt, now, healthy = true, waitUntil = 0, retryAfter = 0 }) {
  if (!installed) return { due: false, reason: "Frontpage isn't installed in ~/Applications (npm run safari:install)" };
  if (now < retryAfter) return { due: false, reason: `the last attempt failed; trying again after ${stamp(retryAfter)}` };
  if (expiresAt == null) return { due: true, reason: "the installed copy isn't team-signed" };
  // Builds with no provisioning profile carry no 7-day date to watch, so notice
  // the drop itself if Safari makes one anyway.
  if (!healthy) return { due: true, reason: "the signature no longer verifies, or Safari no longer lists Frontpage" };
  if (now < waitUntil) {
    return { due: false, reason: `signed until ${stamp(expiresAt)}; Apple gave back the same profile last time, so renewing once it runs out` };
  }
  if (expiresAt - now > RENEW_WITHIN) return { due: false, reason: `signed until ${stamp(expiresAt)}` };
  return { due: true, reason: `the signature ${expiresAt > now ? "runs" : "ran"} out at ${stamp(expiresAt)}` };
}

/**
 * What a build achieved, from the signature's expiry before and after it:
 * "renewed"; "same" when Apple handed back the profile it already had; or a
 * failure: "unsigned" (Aqueduct fell back to ad-hoc signing) or "expired".
 */
export function renewalOutcome(before, after, now) {
  if (after == null) return "unsigned";
  if (after <= now) return "expired";
  if (before != null && after <= before) return "same";
  return "renewed";
}

/**
 * Aqueduct's arguments: convert the snapshot, sign it, install it quietly.
 * With a team id rather than "auto", Aqueduct fails instead of falling back to
 * ad-hoc signing when it can't sign, so a renewal can't swap a working copy for
 * one that Safari drops when it quits.
 */
export function aqueductArgs(team = "auto") {
  return [
    SNAPSHOT,
    "--install",
    "--team", team,
    "--bundle-id", BUNDLE_ID,
    "--app-name", APP_NAME,
    "--output", BUILD,
    "--clean", // no leftovers from the last build
    "--ci", // copy the files into the Xcode project rather than linking back to the snapshot
    // Its stand-ins for Chrome APIs (about 540 KB) would load with every new
    // tab, and the page needs none of them. Its storage.sync stand-in would
    // even make setSynced() delete what it had just saved.
    "--no-shim",
    "--no-oauth-bridge",
    "--no-safari-restart", // never quit Safari while you're using it
    "--background-launch", // register the extension without opening a window
  ];
}

/** Whether pluginkit's compact listing shows the extension turned on: true, false, or null if it can't tell. */
export function extensionEnabled(listing, bundleId = BUNDLE_ID) {
  for (const line of listing.split("\n")) {
    const at = line.indexOf(`${bundleId}.Extension`);
    if (at === -1) continue;
    // pluginkit marks the user's choice before the id: + for on, - for off.
    const flags = line.slice(0, at);
    if (flags.includes("+")) return true;
    if (flags.includes("-")) return false;
    return null;
  }
  return null;
}

const xmlText = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const shellText = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;

/** The launcher the LaunchAgent starts: says what it is, then runs `renew`. */
export function launcherScript({ node, script, cwd }) {
  return `#!/bin/sh
# Frontpage Safari Renewal
#
# Keeps the Frontpage new tab extension for Safari signed. Safari only keeps an
# extension you built yourself while its Apple signature is valid, and a free
# Apple ID's can run out after 7 days, so this re-signs it when needed.
# Started every hour and at login by
#   ~/Library/LaunchAgents/${LABEL}.plist
# Written by \`npm run safari:schedule\` in ${cwd}
# To stop it: \`npm run safari:unschedule\` there (or delete both files).
cd ${shellText(cwd)} || exit 1
exec ${shellText(node)} ${shellText(script)} renew
`;
}

/** The LaunchAgent that runs the launcher every hour and at login. */
export function agentPlist({ program, cwd, log, env }) {
  const vars = Object.entries(env)
    .map(([name, value]) => `    <key>${xmlText(name)}</key>\n    <string>${xmlText(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlText(program)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlText(cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${vars}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlText(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlText(log)}</string>
</dict>
</plist>
`;
}

// ----- the Mac -----

const say = (message) => console.log(message);
// Swedish formatting is ISO-like local time: "2026-11-18 21:05:33".
const log = (message) => console.log(`[${new Date().toLocaleString("sv-SE")}] ${message}`);
const tilde = (path) => path.replace(homedir(), "~");
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", ...options });

/** The environment for Aqueduct: the full Xcode app, even when xcode-select points at the Command Line Tools. */
function xcodeEnv() {
  if (process.env.DEVELOPER_DIR) return process.env;
  const selected = run("/usr/bin/xcode-select", ["-p"]).stdout?.trim() ?? "";
  if (selected && !selected.includes("CommandLineTools")) return process.env;
  if (existsSync(XCODE)) return { ...process.env, DEVELOPER_DIR: XCODE };
  throw new Error("Aqueduct needs the full Xcode app, not just the Command Line Tools. Install Xcode from the App Store and open it once.");
}

/** A provisioning profile decoded to plist text, or "" if it can't be read. */
function decodeProfile(file) {
  const result = run("/usr/bin/security", ["cms", "-D", "-i", file]);
  return result.status === 0 ? result.stdout : "";
}

/** The team a bundle is signed by, from codesign, or null (ad-hoc or unsigned). */
function signingTeam(bundle) {
  const details = run("/usr/bin/codesign", ["-dvv", bundle]).stderr ?? "";
  return /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(details)?.[1] ?? null;
}

/** When the certificate a bundle is signed with runs out, or null. */
function certificateExpiry(bundle) {
  const dir = mkdtempSync(join(tmpdir(), "frontpage-cert-"));
  try {
    run("/usr/bin/codesign", ["-d", `--extract-certificates=${join(dir, "cert")}`, bundle]);
    const leaf = join(dir, "cert0");
    if (!existsSync(leaf)) return null;
    const time = Date.parse(new X509Certificate(readFileSync(leaf)).validTo);
    return Number.isFinite(time) ? time : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The installed app and its extensions. */
function installedBundles() {
  const plugins = join(APP, "Contents/PlugIns");
  const extensions = existsSync(plugins)
    ? readdirSync(plugins)
        .filter((name) => name.endsWith(".appex"))
        .map((name) => join(plugins, name))
    : [];
  return [APP, ...extensions];
}

/**
 * When the installed signature runs out: the earliest of the signing
 * certificate and any provisioning profile. Xcode leaves the profile out when
 * nothing needs one, and then only the certificate (a year) limits it. Null
 * when the app isn't team-signed.
 */
function installedExpiry() {
  if (!existsSync(APP) || !signingTeam(APP)) return null;
  const profiles = installedBundles()
    .map((bundle) => join(bundle, "Contents/embedded.provisionprofile"))
    .filter((file) => existsSync(file));
  const times = [certificateExpiry(APP), ...profiles.map((file) => profileExpiry(decodeProfile(file)))];
  return times.includes(null) ? null : Math.min(...times);
}

/** Whether a provisioning profile is in the installed app, for status. */
const hasProfile = () => existsSync(join(APP, "Contents/embedded.provisionprofile"));

/** The team the installed app is signed by, or null. */
function installedTeam() {
  return existsSync(APP) ? signingTeam(APP) : null;
}

/** Whether pluginkit lists the extension at all (true even when it records no on/off choice). */
export function extensionListed(listing, bundleId = BUNDLE_ID) {
  return listing.includes(`${bundleId}.Extension(`);
}

/** The installed signature still verifies and Safari still lists the extension. */
function installedHealthy() {
  const verifies = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", APP]).status === 0;
  return verifies && extensionListed(pluginkit());
}

/** Stops before building, saying what to do, when Xcode can't sign yet. */
function checkXcode(env, team) {
  if (run("/usr/bin/xcodebuild", ["-license", "check"], { env }).status !== 0) {
    throw new Error("Xcode's licence hasn't been accepted yet. Open Xcode once and agree to it, or run: sudo xcodebuild -license accept");
  }
  // Without a certificate Aqueduct would find no team and quietly build an
  // ad-hoc copy, which Safari only keeps until it quits.
  const identities = (validOnly) =>
    run("/usr/bin/security", ["find-identity", ...(validOnly ? ["-v"] : []), "-p", "codesigning"]).stdout ?? "";
  if (team === "auto" && !identities(true).includes("Apple Development")) {
    // A certificate macOS can't trust is usually missing Apple's current
    // intermediate (WWDR G3); keychains set up years ago only have the expired one.
    if (identities(false).includes("Apple Development")) {
      throw new Error(
        "Your Apple Development certificate is there, but macOS can't verify it, usually because Apple's " +
          "intermediate certificate is missing. Install it, then run this again:\n" +
          "  curl -fsSLo /tmp/AppleWWDRCAG3.cer https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer\n" +
          "  security add-certificates -k ~/Library/Keychains/login.keychain-db /tmp/AppleWWDRCAG3.cer",
      );
    }
    throw new Error(
      "There's no Apple Development certificate yet. In Xcode → Settings → Accounts, add your Apple ID, " +
        "select it, then Manage Certificates… → + → Apple Development.",
    );
  }
}

/** Deletes Xcode's cached profiles for Frontpage, so that the next build fetches a fresh one. */
function clearCachedProfiles() {
  let removed = 0;
  for (const dir of PROFILE_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.(provisionprofile|mobileprovision)$/.test(name)) continue;
      const file = join(dir, name);
      const bundleId = profileBundleId(decodeProfile(file));
      if (bundleId === BUNDLE_ID || bundleId === `${BUNDLE_ID}.Extension`) {
        unlinkSync(file);
        removed += 1;
      }
    }
  }
  return removed;
}

const pluginkit = () => run("/usr/bin/pluginkit", ["-mv", "-p", "com.apple.Safari.web-extension"]).stdout ?? "";

function notify(message) {
  const quoted = `"${message.replace(/[\\"]/g, "\\$&")}"`;
  run("/usr/bin/osascript", ["-e", `display notification ${quoted} with title "Frontpage for Safari"`]);
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Converts, signs and installs the snapshot. Throws if Aqueduct fails. */
function build(env) {
  if (!existsSync(join(SNAPSHOT, "manifest.json"))) {
    throw new Error("There's no copy to build in dist/safari/source. Run npm run safari:install first.");
  }
  const manifest = join(root, "node_modules/@magicelk235/aqueduct/package.json");
  if (!existsSync(manifest)) throw new Error("Aqueduct isn't installed. Run npm install first.");
  const cli = join(dirname(manifest), JSON.parse(readFileSync(manifest, "utf8")).bin.aqueduct);
  // Once installed, keep to the team it was signed with.
  const team = installedTeam() ?? "auto";
  checkXcode(env, team);

  const removed = clearCachedProfiles();
  if (removed) say(`Removed ${removed} cached provisioning profile(s), so Xcode fetches a fresh one.`);
  const result = spawnSync(process.execPath, [cli, ...aqueductArgs(team)], { stdio: "inherit", env, cwd: root });
  if (result.status !== 0) throw new Error(`Aqueduct failed (exit ${result.status ?? result.signal}); its messages are above.`);
  quitApp();
}

/**
 * Aqueduct launches the app so that Safari registers the new extension, and the
 * app then sits in the Dock for good. Safari runs the extension without it, so
 * quit it once pluginkit lists the extension.
 */
function quitApp() {
  for (let attempt = 0; attempt < 15 && !extensionListed(pluginkit()); attempt += 1) run("/bin/sleep", ["1"]);
  run("/usr/bin/osascript", ["-e", `quit app id "${BUNDLE_ID}"`]);
}

/** Checks the signature a build left installed and records it. Throws if Safari won't keep it. */
function record(before, state) {
  const now = Date.now();
  const after = installedExpiry();
  const outcome = renewalOutcome(before, after, now);
  if (outcome === "unsigned") {
    throw new Error(
      "The new build isn't team-signed: Aqueduct found no Apple team and fell back to ad-hoc signing, " +
        "which Safari drops when it quits. In Xcode → Settings → Accounts, add your Apple ID, then " +
        "Manage Certificates… → + → Apple Development.",
    );
  }
  if (outcome === "expired") throw new Error(`The new signature had already run out (${stamp(after)}).`);
  writeState({
    ...state,
    expiresAt: after,
    lastAttemptAt: now,
    lastResult: outcome,
    lastError: "",
    retryAfter: 0,
    // Still inside the renewal window with the same date: Apple gave back the
    // profile it already had, so there's no point asking again until it runs out.
    waitUntil: outcome === "same" && after - now <= RENEW_WITHIN ? before : 0,
  });
  return { after, outcome };
}

// ----- commands -----

function install() {
  const env = xcodeEnv();
  checkXcode(env, installedTeam() ?? "auto"); // before the copy that renewals rebuild is replaced
  const chrome = spawnSync(process.execPath, [join(root, "dev/build.mjs")], { stdio: "inherit" });
  if (chrome.status !== 0) throw new Error("The Chrome build failed.");
  rmSync(SNAPSHOT, { recursive: true, force: true });
  cpSync(join(root, "dist/chrome"), SNAPSHOT, { recursive: true });

  const before = installedExpiry();
  build(env);
  const { after } = record(before, readState());
  const version = JSON.parse(readFileSync(join(SNAPSHOT, "manifest.json"), "utf8")).version;
  say(`\nFrontpage ${version} is in ${tilde(APP)}, signed until ${stamp(after)}.`);
  if (extensionEnabled(pluginkit()) !== true) {
    say("Next:");
    say("  1. Safari → Settings → Extensions: turn on Frontpage.");
    say("  2. Use Frontpage for new windows and new tabs (Safari → Settings → General).");
    say("  3. Import your toolbar: Frontpage's settings → Import from Firefox…, with the file from");
    say("     Firefox's Bookmarks → Manage Bookmarks → Import and Backup → Backup….");
  }
  if (!existsSync(AGENT)) say("Run npm run safari:schedule to keep it signed.");
}

function renew({ force }) {
  const state = readState();
  const now = Date.now();
  const before = installedExpiry();
  const check = force
    ? { due: true, reason: "asked to renew now" }
    : renewalDue({
        installed: existsSync(APP),
        expiresAt: before,
        now,
        healthy: existsSync(APP) && installedHealthy(),
        waitUntil: state.waitUntil,
        retryAfter: state.retryAfter,
      });
  if (!check.due) {
    log(`Nothing to do: ${check.reason}.`);
    return 0;
  }

  log(`Renewing: ${check.reason}.`);
  const wasOn = extensionEnabled(pluginkit());
  try {
    build(xcodeEnv());
    const { after, outcome } = record(before, state);
    log(outcome === "same" ? `Re-signed; it still runs out at ${stamp(after)}.` : `Renewed: signed until ${stamp(after)}.`);
    if (wasOn === true && extensionEnabled(pluginkit()) === false) {
      notify("Safari turned Frontpage off when it was re-signed. Turn it back on in Safari → Settings → Extensions.");
    }
    return 0;
  } catch (error) {
    log(`Renewal failed: ${error.message}`);
    const failed = { ...state, lastAttemptAt: now, lastResult: "failed", lastError: error.message, retryAfter: now + RETRY_AFTER_FAILURE };
    // Run by hand, the reason is right there in the terminal.
    if (!force && now - (state.notifiedAt ?? 0) >= NOTIFY_EVERY) {
      notify("Frontpage couldn't renew its Safari signature. Run npm run safari:renew in the frontpage folder to see why.");
      failed.notifiedAt = now;
    }
    writeState(failed);
    return 1;
  }
}

function status() {
  const state = readState();
  const expiry = installedExpiry();
  const left = expiry == null ? 0 : expiry - Date.now();
  const days = left > 48 * HOUR ? `${Math.floor(left / (24 * HOUR))} days` : `${Math.max(0, Math.floor(left / HOUR))} hours`;
  const listing = pluginkit();
  const enabled = extensionEnabled(listing);
  const scheduled = run("/bin/launchctl", ["print", `gui/${process.getuid()}/${LABEL}`]).status === 0;
  // Aqueduct numbers the app itself; the extension's own version is in the snapshot it was built from.
  let version = "";
  try {
    version = JSON.parse(readFileSync(join(SNAPSHOT, "manifest.json"), "utf8")).version;
  } catch {}

  say("Frontpage for Safari");
  say(`  Installed:     ${existsSync(APP) ? `${tilde(APP)}${version ? `, Frontpage ${version}` : ""}` : "no (npm run safari:install)"}`);
  if (existsSync(APP)) {
    const limit = hasProfile() ? "provisioning profile" : "certificate; no provisioning profile";
    say(`  Signed until:  ${expiry == null ? "not team-signed" : `${stamp(expiry)} (${left > 0 ? `in ${days}` : "ran out"}; ${limit})`}`);
    const onOff = enabled === true ? ", turned on" : enabled === false ? ", turned off (Safari → Settings → Extensions)" : "";
    say(`  In Safari:     ${extensionListed(listing) ? `listed${onOff}` : "not listed"}`);
  }
  say(`  Renewal:       ${scheduled ? `scheduled, hourly; log at ${tilde(LOG)}` : "not scheduled (npm run safari:schedule)"}`);
  if (state.lastAttemptAt) {
    const result = state.lastResult === "failed" ? `failed: ${state.lastError}` : state.lastResult;
    say(`  Last build:    ${stamp(state.lastAttemptAt)}, ${result}`);
  }
}

function schedule() {
  // Volta's shim keeps working across Node upgrades; the binary running this may not.
  const voltaHome = process.env.VOLTA_HOME ?? join(homedir(), ".volta");
  const voltaNode = join(voltaHome, "bin/node");
  const node = existsSync(voltaNode) ? voltaNode : process.execPath;
  const env = {
    PATH: [dirname(node), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
    ...(node === voltaNode ? { VOLTA_HOME: voltaHome } : {}),
  };
  mkdirSync(dirname(AGENT), { recursive: true });
  mkdirSync(dirname(LOG), { recursive: true });
  mkdirSync(dirname(LAUNCHER), { recursive: true });
  writeFileSync(LAUNCHER, launcherScript({ node, script: fileURLToPath(import.meta.url), cwd: root }), { mode: 0o755 });
  chmodSync(LAUNCHER, 0o755); // writeFileSync's mode only applies to a new file
  writeFileSync(AGENT, agentPlist({ program: LAUNCHER, cwd: root, log: LOG, env }));

  const domain = `gui/${process.getuid()}`;
  run("/bin/launchctl", ["bootout", `${domain}/${LABEL}`]); // fails harmlessly when it isn't loaded
  // Straight after a bootout, launchd sometimes refuses the bootstrap for a moment.
  let loaded;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt) run("/bin/sleep", ["1"]);
    loaded = run("/bin/launchctl", ["bootstrap", domain, AGENT]);
    if (loaded.status === 0) break;
  }
  if (loaded.status !== 0) throw new Error(`launchctl couldn't load ${tilde(AGENT)}: ${loaded.stderr.trim()}`);
  say(`Scheduled: renewal checks run every hour and at login. Log: ${tilde(LOG)}`);
}

function unschedule() {
  run("/bin/launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);
  if (existsSync(AGENT)) unlinkSync(AGENT);
  if (existsSync(LAUNCHER)) unlinkSync(LAUNCHER);
  say("Unscheduled. Frontpage stays in Safari until its signature runs out.");
}

const COMMANDS = { install, renew, status, schedule, unschedule };

async function main([command, ...flags]) {
  const action = COMMANDS[command];
  if (!action) {
    console.error("usage: node dev/safari.mjs install | renew [--force] | status | schedule | unschedule");
    return 2;
  }
  try {
    return (await action({ force: flags.includes("--force") })) ?? 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

// Only when run, not when dev/check.mjs imports the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
