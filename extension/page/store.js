// Thin wrappers around extension storage.
//
// "Synced" values live in storage.sync so they follow the browser's own sync
// (Firefox Sync, Chrome Sync). If a value is too big for sync's per-item quota
// it falls back to storage.local; on read the newer of the two copies (by
// updatedAt) wins.

export async function getLocal(key, fallback) {
  const found = await browser.storage.local.get(key);
  return found[key] ?? fallback;
}

export function setLocal(key, value) {
  return browser.storage.local.set({ [key]: value });
}

export async function getSynced(key, fallback) {
  const [synced, local] = await Promise.all([
    browser.storage.sync.get(key).catch(() => ({})),
    browser.storage.local.get(key),
  ]);
  const a = synced[key];
  const b = local[key];
  if (a && b) return (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a;
  return a ?? b ?? fallback;
}

/** Resolves true if the value went to sync storage, false if it only fit locally. */
export async function setSynced(key, value) {
  try {
    await browser.storage.sync.set({ [key]: value });
    await browser.storage.local.remove(key);
    return true;
  } catch {
    await browser.storage.local.set({ [key]: value });
    return false;
  }
}

/** Calls back with the new value whenever `key` is written from another page. */
export function onStored(key, callback) {
  browser.storage.onChanged.addListener((changes) => {
    const value = changes[key]?.newValue;
    if (value) callback(value);
  });
}
