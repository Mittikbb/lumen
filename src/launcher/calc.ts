/**
 * Tiny calculator for the launcher: + - * / ^ %, parentheses, unary minus,
 * decimal comma or dot, × ÷ and spaces as thousands separators.
 * Returns null for anything that isn't a complete expression with an operator.
 */
export function calculate(input: string): number | null {
  const src = input
    .replace(/[×xх]/gi, "*")
    .replace(/÷/g, "/")
    .replace(/(\d)\s+(?=\d{3}\b)/g, "$1") // "1 000" -> "1000"
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
  if (!/^[\d.+\-*/^%()]+$/.test(src) || !/\d/.test(src) || !/[+\-*/^%(]/.test(src.slice(1))) {
    return null;
  }

  let pos = 0;
  const peek = () => src[pos];
  const eat = (c: string) => (src[pos] === c ? (pos++, true) : false);

  // expr := term (("+" | "-") term)*
  const expr = (): number => {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  };
  // term := power (("*" | "/" | "%") power)*
  const term = (): number => {
    let v = power();
    for (;;) {
      if (eat("*")) v *= power();
      else if (eat("/")) v /= power();
      else if (peek() === "%" && /[\d(]/.test(src[pos + 1] ?? "")) {
        pos++;
        v %= power();
      } else return v;
    }
  };
  // power := unary ("^" power)?
  const power = (): number => {
    const base = unary();
    return eat("^") ? base ** power() : base;
  };
  // unary := "-" unary | atom "%"?   (trailing % means percent: 15% = 0.15)
  const unary = (): number => {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    let v = atom();
    if (peek() === "%" && !/[\d(]/.test(src[pos + 1] ?? "")) {
      pos++;
      v /= 100;
    }
    return v;
  };
  const atom = (): number => {
    if (eat("(")) {
      const v = expr();
      if (!eat(")")) throw new Error("unclosed");
      return v;
    }
    const m = /^\d*\.?\d+/.exec(src.slice(pos));
    if (!m) throw new Error("number expected");
    pos += m[0].length;
    return parseFloat(m[0]);
  };

  try {
    const v = expr();
    return pos === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** "1956", "0,333333", "1,2e+21" — Russian decimal comma, thin-space thousands. */
export function formatNumber(v: number): string {
  if (Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-6)) {
    return v.toExponential(6).replace(".", ",");
  }
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 8 });
}

/** Plain machine-readable form for copying: "1956", "0.333333". */
export function plainNumber(v: number): string {
  return String(Number(v.toPrecision(12)));
}
