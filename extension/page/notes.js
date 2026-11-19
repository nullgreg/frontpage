import { getLocal, setLocal, getSynced, setSynced, onStored } from "./store.js";
import { icon } from "./dom.js";

const $ = (id) => document.getElementById(id);

/** The slide-out scratchpad and to-do list, saved through browser sync. */
export async function initNotes() {
  const panel = $("notes-panel");
  const toggle = $("notes-toggle");
  const text = $("notes-text");
  const list = $("todo-list");
  const input = $("todo-input");
  const clear = $("todo-clear");
  const status = $("notes-status");

  let state = { text: "", todos: [], updatedAt: 0, ...(await getSynced("notes", {})) };
  let dirty = false;
  let timer;

  // ----- persistence -----
  async function save() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    state.updatedAt = Date.now();
    const synced = await setSynced("notes", state);
    status.textContent = synced ? "Saved" : "Saved on this device only (too long to sync)";
  }

  function changed() {
    dirty = true;
    status.textContent = "";
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  }

  // ----- rendering -----
  function renderTodos() {
    list.replaceChildren(
      ...state.todos.map((todo) => {
        const row = document.createElement("li");
        row.className = todo.done ? "todo done" : "todo";

        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = todo.done;
        box.setAttribute("aria-label", todo.text);
        // Updated in place rather than re-rendered, so the checkbox keeps focus.
        box.addEventListener("change", () => {
          todo.done = box.checked;
          row.classList.toggle("done", todo.done);
          updateClear();
          changed();
        });

        const label = document.createElement("span");
        label.className = "todo-text";
        label.textContent = todo.text;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-btn";
        remove.setAttribute("aria-label", `Delete "${todo.text}"`);
        remove.append(icon("i-close"));
        remove.addEventListener("click", () => {
          state.todos = state.todos.filter((other) => other !== todo);
          renderTodos();
          changed();
        });

        row.append(box, label, remove);
        return row;
      }),
    );
    updateClear();
  }

  function updateClear() {
    clear.hidden = !state.todos.some((todo) => todo.done);
  }

  function render() {
    if (text.value !== state.text) text.value = state.text;
    renderTodos();
  }

  // ----- panel open / close -----
  function setOpen(open, { focus = false } = {}) {
    panel.classList.toggle("open", open);
    panel.inert = !open;
    document.body.classList.toggle("notes-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    setLocal("notesOpen", open);
    if (open && focus) text.focus();
    if (!open && focus) toggle.focus();
  }

  toggle.addEventListener("click", () => setOpen(!panel.classList.contains("open"), { focus: true }));
  $("notes-close").addEventListener("click", () => setOpen(false, { focus: true }));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false, { focus: true });
  });

  // ----- editing -----
  text.addEventListener("input", () => {
    state.text = text.value;
    changed();
  });

  $("todo-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    state.todos.push({ id: crypto.randomUUID(), text: value, done: false });
    input.value = "";
    renderTodos();
    changed();
  });

  clear.addEventListener("click", () => {
    state.todos = state.todos.filter((todo) => !todo.done);
    renderTodos();
    changed();
  });

  // Don't lose the last few keystrokes when the tab is closed or navigated away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
  window.addEventListener("pagehide", save);

  // Pick up edits made in another tab or synced from another machine.
  onStored("notes", (incoming) => {
    if (dirty || (incoming.updatedAt ?? 0) <= state.updatedAt) return;
    state = { text: "", todos: [], ...incoming };
    render();
  });

  render();
  setOpen(await getLocal("notesOpen", false));
}
