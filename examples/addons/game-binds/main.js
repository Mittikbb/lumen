// Без биндов в Доте: Lumen's shortcuts let go while one of the listed games
// is the app in front, and come back as soon as you Alt+Tab out of it.
let paused = false;

/** "dota2, cs2.exe" → ["dota2", "cs2"]. */
const games = () =>
  String(lumen.settings.apps ?? "")
    .split(/[,;\s]+/)
    .map((name) => name.trim().toLowerCase().replace(/\.exe$/, ""))
    .filter(Boolean);

async function check(front) {
  const inGame = !!front && games().includes(front.app);
  if (inGame === paused) return;
  paused = inGame;
  await lumen.hotkeys.pause(inGame);
  if (lumen.settings.notify) {
    lumen.notify(inGame ? "Бинды выключены" : "Бинды снова работают", front?.title || front?.app || "").catch(() => {});
  }
}

lumen.on("foreground", check);
lumen.on("settings", async () => check(await lumen.foreground.get()));
lumen.ready.then(async () => check(await lumen.foreground.get()));
