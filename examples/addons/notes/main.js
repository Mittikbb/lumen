// Заметки: a tab with an input and the list, and "заметка …" in search.
let notes = [];

async function load() {
  await lumen.ready;
  notes = await lumen.storage.get("notes", []);
  render();
}

async function save() {
  notes = notes.slice(0, lumen.settings.limit);
  await lumen.storage.set("notes", notes);
  render();
}

async function add(text) {
  text = text.trim();
  if (!text) return;
  notes.unshift({ id: Date.now().toString(36), text, at: Date.now() });
  await save();
  if (lumen.settings.confirm) lumen.notify("Заметка сохранена", text);
}

const when = (ms) =>
  new Date(ms).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function render() {
  lumen.tab.render({
    type: "column",
    gap: 10,
    children: [
      { type: "input", action: "add", placeholder: "Новая заметка — Enter, чтобы сохранить" },
      notes.length === 0
        ? { type: "text", style: "muted", text: "Заметок пока нет" }
        : {
            type: "column",
            scroll: true,
            grow: true,
            gap: 6,
            children: notes.map((n) => ({
              type: "row",
              gap: 6,
              children: [
                {
                  type: "column",
                  grow: true,
                  children: [
                    { type: "text", text: n.text },
                    { type: "text", style: "muted", text: when(n.at) },
                  ],
                },
                { type: "button", label: "Копировать", style: "ghost", action: "copy", value: n.id },
                { type: "button", label: "✕", style: "ghost", action: "remove", value: n.id },
              ],
            })),
          },
    ],
  });
}

lumen.tab.onAction(async (action, value) => {
  if (action === "add") await add(value);
  if (action === "copy") {
    const note = notes.find((n) => n.id === value);
    if (note) await lumen.copy(note.text);
  }
  if (action === "remove") {
    notes = notes.filter((n) => n.id !== value);
    await save();
  }
});

// "заметка купить хлеб" saves a note; anything else finds notes to copy.
lumen.search.provide((query) => {
  const add = query.match(/^(заметка|note)\s+(.+)/i);
  if (add) return [{ id: "add:" + add[2], title: `Сохранить заметку: «${add[2]}»`, hint: "Enter — сохранить" }];
  const q = query.toLowerCase();
  return notes
    .filter((n) => n.text.toLowerCase().includes(q))
    .slice(0, 3)
    .map((n) => ({ id: n.id, title: n.text, hint: "Заметка · Enter — скопировать", copy: n.text }));
});

lumen.search.onSelect((id) => {
  if (id.startsWith("add:")) add(id.slice(4));
});

lumen.on("settings", render);
load();
