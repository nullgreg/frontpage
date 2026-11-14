export const ENGINES = {
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  google: { name: "Google", url: "https://www.google.com/search?q=" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=" },
  kagi: { name: "Kagi", url: "https://kagi.com/search?q=" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/sp/search?query=" },
};

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_HOST = /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i;

function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

function scoreToken(entry, token) {
  const at = entry.title.indexOf(token);
  if (at === 0) return 100;
  if (at > 0) return /[\p{L}\p{N}]/u.test(entry.title[at - 1]) ? 60 : 80;
  if (entry.host.includes(token)) return 40;
  if (entry.url.includes(token)) return 20;
  if (token.length > 1 && isSubsequence(token, entry.title)) return 10;
  return 0;
}

/** 0 unless every token matches; higher is better. */
function score(entry, tokens) {
  let total = 0;
  for (const token of tokens) {
    const points = scoreToken(entry, token);
    if (!points) return 0;
    total += points;
  }
  return total;
}

/**
 * Wires the search box: typing filters the bookmark entries, Enter opens the
 * highlighted one or falls through to a URL / web search.
 */
export function createSearch({ input, form, hint, getEntries, getEngine, onFiltered }) {
  let visible = [];
  let active = null;

  function setActive(entry) {
    active?.link.classList.remove("active");
    active = entry;
    active?.link.classList.add("active");
    active?.link.scrollIntoView({ block: "nearest" });
  }

  function refresh() {
    const entries = getEntries();
    const query = input.value.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    setActive(null);
    visible = [];

    let best = null;
    let bestScore = 0;
    const shownSections = new Set();
    const shownCards = new Set();
    for (const entry of entries) {
      const points = tokens.length ? score(entry, tokens) : 1;
      entry.row.hidden = !points;
      if (!points) continue;
      visible.push(entry);
      shownSections.add(entry.section);
      shownCards.add(entry.card);
      if (points > bestScore) {
        best = entry;
        bestScore = points;
      }
    }
    for (const entry of entries) {
      entry.section.hidden = !shownSections.has(entry.section);
      entry.card.hidden = !shownCards.has(entry.card);
    }
    onFiltered();

    if (tokens.length && best) setActive(best);
    const noMatch = tokens.length > 0 && !best && entries.length > 0;
    hint.hidden = !noMatch;
    if (noMatch) {
      hint.textContent = destinationIsUrl(input.value.trim())
        ? "No bookmarks match. Press Enter to open that address."
        : `No bookmarks match. Press Enter to search ${engine().name}.`;
    }
  }

  const engine = () => ENGINES[getEngine()] ?? ENGINES.duckduckgo;
  const destinationIsUrl = (text) => HAS_SCHEME.test(text) || (!/\s/.test(text) && BARE_HOST.test(text));

  function destination(text) {
    if (HAS_SCHEME.test(text)) return text;
    if (destinationIsUrl(text)) return `https://${text}`;
    return engine().url + encodeURIComponent(text);
  }

  function go(newTab) {
    const text = input.value.trim();
    if (!text) return;
    const url = active ? active.href : destination(text);
    if (newTab) window.open(url, "_blank", "noopener");
    else window.location.assign(url);
  }

  function move(step) {
    if (!visible.length) return;
    const index = visible.indexOf(active);
    const next = index < 0 ? 0 : (index + step + visible.length) % visible.length;
    setActive(visible[next]);
  }

  input.addEventListener("input", refresh);
  form.addEventListener("submit", (event) => event.preventDefault());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      go(event.ctrlKey || event.metaKey);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!input.value.trim()) return;
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      if (input.value) {
        input.value = "";
        refresh();
      } else {
        input.blur();
      }
    }
  });

  // "/" or simply starting to type anywhere on the page jumps to the search box.
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    if (event.target.closest?.("input, textarea, select, dialog, [contenteditable]")) return;
    if (event.key === " " && event.target.closest?.("button, a")) return;
    input.focus();
    if (event.key === "/") event.preventDefault();
  });

  return { refresh };
}
