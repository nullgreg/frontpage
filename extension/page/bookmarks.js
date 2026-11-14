const TOOLBAR_ID = "toolbar_____";
// Firefox won't open these from an extension page, by link or by script:
// smart-bookmark queries, bookmarklets, data: URLs, local files and the
// browser's privileged pages (about:config, chrome://, ...).
const UNLINKABLE = /^(place|javascript|data|about|file|chrome|resource|view-source):/i;
const HUES = [218, 268, 322, 172, 36, 196, 292, 142];

const isFolder = (node) => node.type === "folder" || (!node.url && Array.isArray(node.children));
const isBookmark = (node) =>
  Boolean(node.url) && node.type !== "separator" && !UNLINKABLE.test(node.url);

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toItem(node) {
  const host = hostOf(node.url);
  return { title: node.title || host || node.url, url: node.url, host };
}

/** Flattens a folder into sections: its own bookmarks first, then each subfolder. */
function collect(folder, path, out) {
  const items = [];
  const subfolders = [];
  for (const child of folder.children ?? []) {
    if (isBookmark(child)) items.push(toItem(child));
    else if (isFolder(child)) subfolders.push(child);
  }
  if (items.length) out.push({ title: path.join(" / "), items });
  for (const sub of subfolders) collect(sub, [...path, sub.title || "Untitled"], out);
}

/** Reads the bookmarks toolbar as a list of groups, one per top-level folder. */
export async function loadGroups() {
  const [toolbar] = await browser.bookmarks.getSubTree(TOOLBAR_ID);
  const groups = [];
  const loose = [];
  for (const node of toolbar.children ?? []) {
    if (isBookmark(node)) {
      loose.push(toItem(node));
    } else if (isFolder(node)) {
      const sections = [];
      collect(node, [], sections);
      if (sections.length) groups.push({ title: node.title || "Untitled", sections });
    }
  }
  if (loose.length) groups.unshift({ title: "Toolbar", sections: [{ title: "", items: loose }] });
  return groups;
}

/** Calls back (debounced) whenever any bookmark is added, removed, edited or moved. */
export function watchBookmarks(callback) {
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(callback, 150);
  };
  for (const event of ["onCreated", "onRemoved", "onChanged", "onMoved"]) {
    browser.bookmarks[event].addListener(schedule);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function hashHue(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

function tileFor(item, favicons) {
  const letter = (item.title.match(/[\p{L}\p{N}]/u) ?? item.host.match(/[\p{L}\p{N}]/u) ?? ["•"])[0];
  const tile = el("span", "tile", letter);
  tile.style.setProperty("--tile-hue", hashHue(item.host || item.title));
  tile.setAttribute("aria-hidden", "true");

  if (favicons && /^https?:/i.test(item.url)) {
    const img = new Image(16, 16);
    img.className = "tile-img";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => {
      if (img.naturalWidth > 1) tile.classList.add("has-icon");
      else img.remove();
    });
    img.addEventListener("error", () => img.remove());
    img.src = `${new URL(item.url).origin}/favicon.ico`;
    tile.append(img);
  }
  return tile;
}

const COLUMN_MIN = 270;
const GAP = 18;

/**
 * The card grid. Cards are dealt into flex columns by script (shortest column
 * first) because CSS multi-column layout splits rows across columns in Firefox.
 *
 * render() returns one search entry per bookmark:
 * { row, link, card, section, title, host, url, href }.
 */
export function createGrid(grid) {
  let cards = [];
  let columnCount = 0;

  const columnsThatFit = () =>
    Math.max(1, Math.floor((grid.clientWidth + GAP) / (COLUMN_MIN + GAP)));

  // Rough height of a card, counting only what the current filter leaves visible.
  const weight = (card) =>
    1.5 +
    card.querySelectorAll("li:not([hidden])").length +
    card.querySelectorAll(".card-section:not([hidden]) > .card-sub").length * 1.3;

  function layout() {
    if (!cards.length) return; // leaves render()'s "toolbar is empty" message in place
    const shown = cards.filter((card) => !card.hidden);
    columnCount = columnsThatFit();
    const count = Math.max(1, Math.min(columnCount, shown.length));
    const columns = Array.from({ length: count }, () => ({ node: el("div", "col"), height: 0 }));
    for (const card of shown) {
      const shortest = columns.reduce((a, b) => (b.height < a.height ? b : a));
      shortest.node.append(card);
      shortest.height += weight(card);
    }
    grid.replaceChildren(...columns.map((column) => column.node));
  }

  new ResizeObserver(() => {
    if (cards.length && columnsThatFit() !== columnCount) layout();
  }).observe(grid);

  function render(groups, { favicons }) {
    const entries = [];
    cards = [];
    if (!groups.length) {
      grid.replaceChildren(
        el("p", "empty", "Your bookmarks toolbar is empty. Add bookmarks or folders to it and they will appear here."),
      );
      return entries;
    }

    groups.forEach((group, index) => {
      const card = el("section", "card");
      card.style.setProperty("--hue", HUES[index % HUES.length]);

      const count = group.sections.reduce((sum, section) => sum + section.items.length, 0);
      const head = el("header", "card-head");
      head.append(el("span", "card-dot"), el("h2", "card-title", group.title), el("span", "card-count", count));
      card.append(head);

      for (const section of group.sections) {
        const block = el("div", "card-section");
        if (section.title) block.append(el("h3", "card-sub", section.title));
        const list = el("ul", "links");
        for (const item of section.items) {
          const row = el("li");
          const link = el("a", "link");
          link.href = item.url;
          link.title = `${item.title}\n${item.url}`;
          link.append(tileFor(item, favicons), el("span", "link-title", item.title));
          row.append(link);
          list.append(row);
          entries.push({
            row,
            link,
            card,
            section: block,
            title: item.title.toLowerCase(),
            host: item.host.toLowerCase(),
            url: item.url.toLowerCase(),
            href: item.url,
          });
        }
        block.append(list);
        card.append(block);
      }
      cards.push(card);
    });
    layout();
    return entries;
  }

  return { render, layout };
}
