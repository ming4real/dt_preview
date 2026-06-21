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
};

export type DtNode = {
  name: string;
  unitAddress?: string;
  labels: string[];
  kind?: "node" | "root" | "reference";
  referenceLabel?: string;
  properties: DtProperty[];
  children: DtNode[];
  source: SourceSpan;
  diagnostics?: DtDiagnostic[];
};
