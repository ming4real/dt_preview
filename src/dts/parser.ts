import { lexDts, Token } from "./lexer";
import { DtNode, DtProperty, SourceSpan } from "./types";

export function parseDts(text: string, file: string): DtNode {
  const tokens = lexDts(text, file).filter(t => t.type !== "comment");
  console.log("Reading file: " + file);

  let pos = 0;

  function peek(offset = 0): Token {
    return tokens[pos + offset];
  }

  function advance(): Token {
    return tokens[pos++];
  }

  function match(value: string): boolean {
    if (peek()?.value === value) {
      advance();
      return true;
    }
    return false;
  }

  function spanFrom(start: Token, end?: Token): SourceSpan {
    return {
      file: start.location.file,
      startLine: start.location.line,
      endLine: end?.location.line ?? start.location.line,
    };
  }

  function readValueUntilSemicolon(): string {
    const parts: string[] = [];

    while (peek() && peek().type !== "eof" && peek().value !== ";") {
      parts.push(advance().value);
    }

    match(";");

    return parts.join(" ");
  }

  function parseProperty(startToken: Token): DtProperty {
    const name = startToken.value;

    if (match("=")) {
      const value = readValueUntilSemicolon();

      return {
        name,
        value,
        source: spanFrom(startToken),
      };
    }

    match(";");

    return {
      name,
      value: "true",
      source: spanFrom(startToken),
    };
  }

  function parseNode(firstToken: Token): DtNode {
    let name = firstToken.value;
    let unitAddress: string | undefined;
    const labels: string[] = [];

    if (peek().value === ":") {
      labels.push(name);
      advance();
      name = advance().value;
    }

    if (match("@")) {
      unitAddress = advance().value;
    }

    const node: DtNode = {
      name,
      unitAddress,
      labels,
      properties: [],
      children: [],
      source: spanFrom(firstToken),
    };

    if (!match("{")) {
      return node;
    }

    while (peek() && peek().type !== "eof" && peek().value !== "}") {
      const current = advance();

      if (current.type !== "identifier" && current.value !== "/") {
        continue;
      }

      const next = peek();

      if (next?.value === "{" || next?.value === "@" || next?.value === ":") {
        node.children.push(parseNode(current));
      } else {
        node.properties.push(parseProperty(current));
      }
    }

    const end = advance();
    match(";");

    node.source.endLine = end.location.line;

    return node;
  }

  const root: DtNode = {
    name: "/",
    labels: [],
    properties: [],
    children: [],
    source: {
      file,
      startLine: 1,
      endLine: 1,
    },
  };

  while (peek() && peek().type !== "eof") {
    const token = advance();

    if (token.value === "/" && peek()?.value === "{") {
      root.children.push(parseNode(token));
    } else if (token.type === "identifier") {
      if (peek()?.value === "{" || peek()?.value === "@" || peek()?.value === ":") {
        root.children.push(parseNode(token));
      }
    }
  }

  return root;
}