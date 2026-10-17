// Помидор: work and rest in turns. While it runs, the collapsed island shows
// a line with the time left and a bar filling along its bottom edge.
let phase = null; // { kind: "work" | "rest", ends, total }
let ticker = 0;

const minutes = (kind) => (kind === "work" ? lumen.settings.work : lumen.settings.rest) * 60_000;
const label = (kind) => (kind === "work" ? "Работа" : "Перерыв");

function format(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function start(kind) {
  const total = minutes(kind);
  phase = { kind, total, ends: Date.now() + total };
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
  tick();
}

function stop() {
  phase = null;
  clearInterval(ticker);
  lumen.activity.hide();
  render();
}

function tick() {
  if (!phase) return;
  const left = phase.ends - Date.now();
  if (left <= 0) {
    const next = phase.kind === "work" ? "rest" : "work";
    lumen.notify(phase.kind === "work" ? "Пора отдохнуть" : "Перерыв окончен", `${label(next)} — ${lumen.settings[next]} мин`);
    start(next);
    return;
  }
  lumen.activity.show({
    icon: phase.kind === "work" ? "🍅" : "☕",
    title: label(phase.kind),
    detail: format(left),
    progress: 1 - left / phase.total,
  });
  render();
}

function render() {
  const left = phase ? phase.ends - Date.now() : minutes("work");
  lumen.tab.render({
    type: "column",
    gap: 14,
    align: "center",
    justify: "center",
    grow: true,
    children: [
      { type: "text", style: "muted", text: phase ? label(phase.kind) : "Готов к работе" },
      { type: "text", style: "big", text: format(left) },
      phase && { type: "progress", value: 1 - left / phase.total },
      {
        type: "row",
        gap: 8,
        children: phase
          ? [
              { type: "button", label: "Стоп", action: "stop" },
              { type: "button", label: phase.kind === "work" ? "К перерыву" : "К работе", action: "skip", style: "ghost" },
            ]
          : [{ type: "button", label: "Начать", action: "work", style: "primary" }],
      },
    ],
  });
}

lumen.tab.onAction((action) => {
  if (action === "work") start("work");
  if (action === "stop") stop();
  if (action === "skip") start(phase?.kind === "work" ? "rest" : "work");
});

lumen.search.provide((query) =>
  /^(помидор|pomodoro|фокус)/i.test(query)
    ? [phase ? { id: "stop", title: "Остановить помидор", hint: label(phase.kind) } : { id: "work", title: "Начать помидор", hint: `${lumen.settings.work} мин работы` }]
    : [],
);

lumen.search.onSelect((id) => (id === "stop" ? stop() : start("work")));
lumen.on("settings", render);
lumen.ready.then(render);
