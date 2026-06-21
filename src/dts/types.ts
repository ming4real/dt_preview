import { SourceLocation } from "./lexer";

export type SourceSpan = {
  file: string;
  startLine: number;
  endLine: number;
};

export type DtProperty = {
  name: string;
  value: string;
  source: SourceSpan;
};

export type DtNode = {
  name: string;
  unitAddress?: string;
  labels: string[];
  properties: DtProperty[];
  children: DtNode[];
  source: SourceSpan;
};