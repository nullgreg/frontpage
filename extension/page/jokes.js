import { getLocal, setLocal } from "./store.js";
import { GENERAL, NERDY } from "./jokes-data.js";

const PUNCHLINE_DELAY_MS = 5000;
// Each of your own jokes comes up about this many times as often as a built-in
// one, so a handful of in-jokes isn't lost among hundreds.
const OWN_WEIGHT = 10;

// ---------- addressing a joke to someone ----------

// Setups whose first word stays capitalized after an opener: the pronoun "I"
// (including "I'm", "I'd", "I've") and proper nouns.
const KEEPS_CAPITAL = /^(I|Velcro)\b/;

const isQuestion = ([setup, punchline]) => setup.endsWith("?") || punchline.endsWith("?");
const isRiddle = ([setup]) => /^(What|Why|How|Where|When|Which|Who)/.test(setup);
const isAnecdote = (joke) => /^(I|My)\b/.test(joke[0]) && !isQuestion(joke);

// Ways to start a joke once a name is set. All end in "," or ":" so the setup
// can follow in lowercase. `fits` limits an opener to jokes it reads well with.
const OPENERS = [
  { text: "Hey {name}," },
  { text: "Hey {name}," },
  { text: "Hey {name}," },
  { text: "{name}," },
  { text: "Okay {name}," },
  { text: "Listen, {name}," },
  { text: "Psst, {name}:" },
  { text: "Hey {name}, got one for you:" },
  { text: "{name}, you'll like this one:" },
  { text: "{name}, quick question:", fits: isQuestion },
  { text: "Hey {name}, serious question:", fits: isQuestion },
  { text: "Riddle me this, {name}:", fits: isRiddle },
  { text: "Guess what, {name}:", fits: isAnecdote },
  { text: "{name}, true story:", fits: isAnecdote },
];

function pickOpener(joke) {
  // A setup that already has a colon reads badly after an opener ending in one.
  const hasColon = joke[0].includes(":");
  const choices = OPENERS.filter(
    (opener) => (!opener.fits || opener.fits(joke)) && !(hasColon && opener.text.endsWith(":")),
  );
  return choices[Math.floor(Math.random() * choices.length)].text;
}

/** "Why did…" -> "Hey Gertrude, why did…"; unchanged when no name is set. */
function address(setup, name, opener) {
  if (!name) return setup;
  const rest = KEEPS_CAPITAL.test(setup) ? setup : setup[0].toLowerCase() + setup.slice(1);
  return `${opener.replace("{name}", name)} ${rest}`;
}

// ---------- your own jokes ----------

/**
 * Turns the settings text into [setup, punchline] pairs, one joke per line.
 * "setup | punchline" says where the pause goes; without a "|" the last
 * sentence is the punchline, and a single sentence has none.
 */
export function parseOwnJokes(text) {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.indexOf("|");
      if (bar >= 0) return [line.slice(0, bar).trim(), line.slice(bar + 1).trim()];
      const sentences = line.match(/^(.*[.?!]["'”’)]?)\s+(\S.*)$/);
      return sentences ? [sentences[1], sentences[2]] : [line, ""];
    })
    .filter(([setup]) => setup);
}

// ---------- decks ----------

function shuffledIndexes(count) {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function hash(text) {
  let value = 0;
  for (const ch of text) value = (value * 31 + ch.codePointAt(0)) >>> 0;
  return value.toString(36);
}

/**
 * Deals the next joke from a shuffled deck kept in storage, so none repeats
 * until the whole pool has been shown. A changed pool (different signature)
 * gets a fresh shuffle.
 */
async function dealFrom(key, pool, signature) {
  let deck = await getLocal(key);
  if (!deck || deck.signature !== signature || deck.position >= deck.order.length) {
    deck = { signature, order: shuffledIndexes(pool.length), position: 0 };
  }
  const joke = pool[deck.order[deck.position]];
  deck.position += 1;
  await setLocal(key, deck);
  return joke;
}

// ---------- the widget ----------

/**
 * Shows a joke in `button`: setup straight away, punchline after a pause.
 * Clicking during the pause reveals the punchline; clicking after deals another.
 */
export function initJokes(button) {
  const setup = document.createElement("span");
  const punchline = document.createElement("span");
  punchline.className = "joke-punchline";
  button.replaceChildren(setup, " ", punchline);

  let enabled = false;
  let name = "";
  let builtIn = GENERAL;
  let builtInSignature = "";
  let own = [];
  let ownText = null;
  let ownSignature = "";

  let joke = null; // { setup, punchline, opener } — opener is null for your own jokes
  let revealed = false;
  let timer;

  async function nextJoke() {
    const ownShare = (own.length * OWN_WEIGHT) / (builtIn.length + own.length * OWN_WEIGHT);
    if (own.length && Math.random() < ownShare) {
      const [ownSetup, ownPunchline] = await dealFrom("ownJokeDeck", own, ownSignature);
      return { setup: ownSetup, punchline: ownPunchline, opener: null };
    }
    const pair = await dealFrom("jokeDeck", builtIn, builtInSignature);
    return { setup: pair[0], punchline: pair[1], opener: pickOpener(pair) };
  }

  function renderText() {
    if (!joke) return;
    // Your own jokes are shown exactly as written; built-in ones get the name.
    setup.textContent = joke.opener ? address(joke.setup, name, joke.opener) : joke.setup;
    punchline.textContent = joke.punchline;
  }

  function reveal() {
    clearTimeout(timer);
    revealed = true;
    button.classList.add("revealed");
    button.title = "Another one";
  }

  function startCountdown() {
    clearTimeout(timer);
    timer = setTimeout(reveal, PUNCHLINE_DELAY_MS);
  }

  async function deal() {
    clearTimeout(timer);
    const next = await nextJoke();
    if (!enabled) return;
    joke = next;
    revealed = false;
    button.classList.remove("in", "revealed");
    renderText();
    button.title = "Show the punchline";
    void button.offsetWidth; // restart the fade-in
    button.classList.add("in");
    if (!joke.punchline) reveal();
    else if (document.visibilityState === "visible") startCountdown();
  }

  button.addEventListener("click", () => {
    if (!joke) return;
    if (revealed) deal();
    else reveal();
  });

  // The pause only counts while the page is on screen, so the punchline never
  // lands in a background tab.
  document.addEventListener("visibilitychange", () => {
    if (!joke || revealed) return;
    if (document.visibilityState === "visible") startCountdown();
    else clearTimeout(timer);
  });

  return {
    /**
     * name: who built-in jokes are addressed to ("" for nobody in particular).
     * nerdy: include the programming and science jokes.
     * ownText: the user's own jokes, as typed in settings.
     * Pool changes apply from the next joke; the one on screen stays.
     */
    configure({ enabled: on, name: who, nerdy, ownText: text }) {
      builtIn = nerdy ? [...GENERAL, ...NERDY] : GENERAL;
      builtInSignature = `${GENERAL.length}+${nerdy ? NERDY.length : 0}`;
      if (text !== ownText) {
        ownText = text;
        own = parseOwnJokes(text);
        ownSignature = `${own.length}:${hash(JSON.stringify(own))}`;
      }

      const nextName = (who ?? "").trim();
      if (nextName !== name) {
        name = nextName;
        renderText(); // re-word the joke on screen without dealing a new one
      }

      if (on === enabled) return;
      enabled = on;
      button.hidden = !on;
      if (on) {
        deal();
      } else {
        clearTimeout(timer);
        joke = null;
      }
    },
  };
}
