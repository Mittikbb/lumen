import { useEffect } from "react";

/**
 * Tints the island glow with the most vivid colour of the album art, or the
 * `fallback` pair without one. The two glow variables are registered with
 * @property, so the change fades.
 */
export function useGlowFromArt(art: string | null | undefined, fallback: { a: string; b: string }) {
  useEffect(() => {
    const root = document.documentElement.style;
    if (!art) {
      root.setProperty("--glow-a", fallback.a);
      root.setProperty("--glow-b", fallback.b);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const [a, b] = vividColors(img);
      root.setProperty("--glow-a", a);
      root.setProperty("--glow-b", b);
    };
    img.src = art;
    return () => {
      cancelled = true;
    };
  }, [art, fallback]);
}

function vividColors(img: HTMLImageElement): [string, string] {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  // Score every pixel by saturation × brightness and keep the best one; dull
  // covers fall back to the average colour, lifted so it still glows.
  let best = { score: -1, h: 0, s: 0, l: 0 };
  let sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    const score = s * (1 - Math.abs(l - 0.55) * 1.6);
    if (score > best.score) best = { score, h, s, l };
  }

  let { h, s } = best;
  if (best.score < 0.15) {
    const n = data.length / 4;
    [h, s] = rgbToHsl(sum[0] / n, sum[1] / n, sum[2] / n);
  }
  s = Math.max(s, 0.55);
  return [hsl(h, s, 0.66), hsl((h + 0.04) % 1, s, 0.56)];
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
