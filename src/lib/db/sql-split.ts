/**
 * Pemecah berkas SQL menjadi statement tunggal.
 *
 * Kenapa ada: `docs/schema.d1.sql` berisi trigger dengan badan
 * `BEGIN ... END;` yang di dalamnya ada titik koma. `D1Database.exec()`
 * memecah berdasarkan titik koma sehingga badan trigger terpotong dan DDL
 * gagal. Pemecah ini sadar akan blok `BEGIN ... END`, tanda kutip, dan
 * komentar — tiga hal yang membuat pemecahan naif salah.
 */

/** Buang komentar `--` dan `/* *\/` di luar tanda kutip. */
export function stripSqlComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < text.length) {
        out += text[i]!;
        if (text[i] === quote) {
          if (text[i + 1] === quote) {
            out += text[i + 1]!;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Pecah SQL menjadi statement. `beginDepth` melacak `BEGIN ... END` milik
 * trigger; titik koma hanya memisah saat kedalamannya nol.
 */
export function splitSqlStatements(sql: string): string[] {
  const text = stripSqlComments(sql);
  const statements: string[] = [];
  let current = '';
  let depth = 0;
  let i = 0;

  const word = (): string => {
    const rest = text.slice(i);
    const match = /^[A-Za-z_]+/.exec(rest);
    return match ? match[0].toUpperCase() : '';
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === "'" || ch === '"') {
      const quote = ch;
      current += ch;
      i += 1;
      while (i < text.length) {
        current += text[i]!;
        if (text[i] === quote) {
          if (text[i + 1] === quote) {
            current += text[i + 1]!;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const token = word();
      current += text.slice(i, i + token.length);
      i += token.length;
      // `CASE` juga ditutup `END`; tanpa menghitungnya, `END` milik CASE akan
      // menutup blok trigger lebih awal dan titik koma berikutnya memotong DDL.
      if (token === 'BEGIN' || token === 'CASE') depth += 1;
      else if (token === 'END' && depth > 0) depth -= 1;
      continue;
    }

    if (ch === ';' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}
