export type SourceSpan = {
  file: string;
  startLine: number;
  endLine: number;
};

export type DtDiagnostic = {
  severity: "warning";
  message: string;
  source?: SourceSpan;
};

export type DtProperty = {
  name: string;
  value: string;
  source: SourceSpan;
  deletedBy?: SourceSpan;
};

export type DtDeleteDirective = {
  kind: "node" | "property";
  target: string;
  referenceLabel?: string;
  source: SourceSpan;
};

export type DtNode = {
  name: string;
  unitAddress?: string;
  label?: string;
  labels: string[];
  kind?: "node" | "root" | "reference";
  referenceLabel?: string;
  deletedBy?: SourceSpan;
  properties: DtProperty[];
  children: DtNode[];
  deleteDirectives: DtDeleteDirective[];
  source: SourceSpan;
  diagnostics?: DtDiagnostic[];
};
