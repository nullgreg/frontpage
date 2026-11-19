// Reads a Firefox bookmarks backup: the .json file Firefox writes from
// Bookmarks → Manage Bookmarks → Import and Backup → Backup…. Safari gives
// extensions no bookmarks API, so there the page shows a toolbar imported this
// way instead. No DOM or browser.* here, so dev/check.mjs can run it under Node.

// Firefox's types for a bookmark and a folder. Separators aren't kept: the
// cards skip them anyway.
const BOOKMARK = "text/x-moz-place";
const FOLDER = "text/x-moz-place-container";

/** A backup node as a bookmarks.getTree() node, keeping only what the cards use. */
function toNode(node) {
  if (node?.type === BOOKMARK && typeof node.uri === "string") {
    return { type: "bookmark", title: String(node.title ?? ""), url: node.uri };
  }
  if (node?.type === FOLDER) {
    return { type: "folder", title: String(node.title ?? ""), children: childrenOf(node) };
  }
  return null;
}

function childrenOf(folder) {
  return Array.isArray(folder.children) ? folder.children.map(toNode).filter(Boolean) : [];
}

/**
 * The toolbar's contents from the text of a Firefox JSON backup, as
 * { type, title, url, children } nodes, the shape bookmarks.getTree() gives.
 * Null when the text isn't a backup with a toolbar (an HTML export, say).
 */
export function parseFirefoxBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    return null;
  }
  // The toolbar is one of the root's own children. Its title is just "toolbar",
  // so it is found by its root name (or its fixed guid) instead.
  const roots = Array.isArray(backup?.children) ? backup.children : [];
  const toolbar = roots.find((node) => node?.root === "toolbarFolder" || node?.guid === "toolbar_____");
  return toolbar?.type === FOLDER ? childrenOf(toolbar) : null;
}
