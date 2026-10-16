import type { GameShown } from "./useGame";

const percent = (v: number | null | undefined) => (v == null ? "…" : `${v}%`);

/** A game starting: its name and the FPS and load beside it, inside the collapsed island. */
export function GameView({ game }: { game: GameShown }) {
  const { stats } = game;
  return (
    <div className="game">
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M7 9h10a4 4 0 0 1 3.9 4.8l-.6 2.9a2 2 0 0 1-3.4 1L15 16H9l-1.9 1.7a2 2 0 0 1-3.4-1l-.6-2.9A4 4 0 0 1 7 9Z" />
        <path d="M8 11.5v3M6.5 13h3" />
        <circle cx="15.5" cy="12.5" r=".6" />
        <circle cx="17" cy="14" r=".6" />
      </svg>
      <span className="game-name">{game.name}</span>
      <span className="game-stats">
        {/* Frames can't be counted without the rights for it: then no FPS at all. */}
        {(!stats || stats.fps != null) && (
          <span className="game-stat fps">
            <b>{stats?.fps ?? "…"}</b>
            <i>FPS</i>
          </span>
        )}
        <span className="game-stat">
          <b>{percent(stats?.cpu)}</b>
          <i>CPU</i>
        </span>
        {(!stats || stats.gpu != null) && (
          <span className="game-stat">
            <b>{percent(stats?.gpu)}</b>
            <i>GPU</i>
          </span>
        )}
        <span className="game-stat">
          <b>{percent(stats?.ram)}</b>
          <i>RAM</i>
        </span>
      </span>
    </div>
  );
}
