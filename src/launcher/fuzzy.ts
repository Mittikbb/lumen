/**
 * Scores how well `name` matches `query` (higher is better, 0 = no match).
 * Prefix > word start > substring > in-order letters ("vsc" → "Visual Studio Code").
 */
export function fuzzyScore(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 800 - n.length;

  const words = n.split(/[\s\-_.()]+/);
  if (words.some((w) => w.startsWith(q))) return 600 - n.length;

  const initials = words.map((w) => w[0] ?? "").join("");
  if (initials.startsWith(q)) return 500 - n.length;

  if (n.includes(q)) return 400 - n.indexOf(q);

  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length ? 100 - n.length / 10 : 0;
}
