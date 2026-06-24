export type SourceLocation = {
  file: string;
  line: number;
  column: number;
  offset: number;
};

export type TokenType =
  | "identifier"
  | "string"
  | "number"
  | "symbol"
  | "directive"
  | "comment"
  | "eof";

export type Token = {
  type: TokenType;
  value: string;
  location: SourceLocation;
};

const SYMBOLS = new Set([
  "{", "}", ";", "=", "<", ">", "[", "]", ":", ",", "@", "&", "/", "(", ")",
]);

export function lexDts(input: string, file: string, startLine = 1): Token[] {
  const tokens: Token[] = [];

  let i = 0;
  let line = startLine;
  let column = 1;

  function loc(): SourceLocation {
    return { file, line, column, offset: i };
  }

  function peek(n = 0): string {
    return input[i + n] ?? "";
  }

  function advance(): string {
    const ch = input[i++] ?? "";

    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }

    return ch;
  }

  function add(type: TokenType, value: string, location: SourceLocation) {
    tokens.push({ type, value, location });
  }

  function isWhitespace(ch: string): boolean {
    return /\s/.test(ch);
  }

  function isIdentifierStart(ch: string): boolean {
    return /[A-Za-z_#]/.test(ch);
  }

  function isIdentifierPart(ch: string): boolean {
    return /[A-Za-z0-9_\-+.,]/.test(ch);
  }

  while (i < input.length) {
    const ch = peek();

    if (isWhitespace(ch)) {
      advance();
      continue;
    }

    const start = loc();

    // // line comment
    if (ch === "/" && peek(1) === "/") {
      let value = "";
      while (i < input.length && peek() !== "\n") {
        value += advance();
      }
      add("comment", value, start);
      continue;
    }

    // /* block comment */
    if (ch === "/" && peek(1) === "*") {
      let value = "";
      value += advance();
      value += advance();

      while (i < input.length) {
        if (peek() === "*" && peek(1) === "/") {
          value += advance();
          value += advance();
          break;
        }
        value += advance();
      }

      add("comment", value, start);
      continue;
    }

    // Strings
    if (ch === '"') {
      let value = "";
      value += advance();

      while (i < input.length) {
        const c = advance();
        value += c;

        if (c === "\\" && i < input.length) {
          value += advance();
          continue;
        }

        if (c === '"') { 
          break;
        }
      }

      add("string", value, start);
      continue;
    }

    // Preprocessor directive, e.g. #include
    if (ch === "#") {
      let value = "";
      while (i < input.length && peek() !== "\n") {
        value += advance();
      }
      add("directive", value.trim(), start);
      continue;
    }

    // Numbers: decimal or hex
    if (/[0-9]/.test(ch)) {
      let value = "";

      while (i < input.length && /[A-Fa-f0-9xX]/.test(peek())) {
        value += advance();
      }

      add("number", value, start);
      continue;
    }

    // Symbols
    if (SYMBOLS.has(ch)) {
      add("symbol", advance(), start);
      continue;
    }

    // Identifiers / labels / property names
    if (isIdentifierStart(ch)) {
      let value = "";

      while (i < input.length && isIdentifierPart(peek())) {
        value += advance();
      }

      add("identifier", value, start);
      continue;
    }

    // Unknown character: keep it as a symbol so parser can report it later
    add("symbol", advance(), start);
  }

  tokens.push({
    type: "eof",
    value: "",
    location: loc(),
  });

  return tokens;
}
