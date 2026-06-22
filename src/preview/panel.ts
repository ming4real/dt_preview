import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { renderHtml } from "./renderHtml";
import { ReadFile, collectTransitiveIncludes, resolveIncludesWithDiagnostics } from "../dts/includeResolver";
import { parseDtsChunks } from "../dts/parser";
import { mergeTrees } from "../dts/merger";

export class DeviceTreePreviewPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static output: vscode.OutputChannel | undefined;
  private static rootFile: string | undefined;
  private static dependencyGraph = new Map<string, Set<string>>();
  private static dependencyClosure = new Set<string>();

  static show(context: vscode.ExtensionContext, sourceFile: string) {
    this.rootFile = path.resolve(sourceFile);

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "deviceTreePreview",
        "Device Tree Preview",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.rootFile = undefined;
        this.dependencyGraph.clear();
        this.dependencyClosure.clear();
      });
    }

    this.update(this.rootFile);
  }

  static update(sourceFile: string, changedFile = sourceFile) {
    if (!this.panel) {
      return;
    }

    try {
      const rootFile = path.resolve(sourceFile);
      const started = Date.now();
      const { chunks, diagnostics, dependencyGraph } = resolveIncludesWithDiagnostics(rootFile, this.readFile);
      const parsed = parseDtsChunks(chunks, rootFile);
      parsed.diagnostics = diagnostics;
      const merged = mergeTrees(parsed);

      this.rootFile = rootFile;
      this.dependencyGraph = dependencyGraph;
      this.dependencyClosure = collectTransitiveIncludes(rootFile, dependencyGraph);
      this.panel.webview.html = renderHtml(merged);
      this.log({
        rootFile,
        changedFile: path.resolve(changedFile),
        triggered: true,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.panel.webview.html = `<pre>${String(error)}</pre>`;
    }
  }

  static handleDocumentChange(changedFile: string) {
    const rootFile = this.rootFile;
    const resolvedChangedFile = path.resolve(changedFile);

    if (!rootFile) {
      return;
    }

    const shouldRebuild = resolvedChangedFile === rootFile || this.dependencyClosure.has(resolvedChangedFile);
    const started = Date.now();

    if (shouldRebuild) {
      this.update(rootFile, resolvedChangedFile);
      return;
    }

    this.log({
      rootFile,
      changedFile: resolvedChangedFile,
      triggered: shouldRebuild,
      durationMs: Date.now() - started,
    });
  }

  private static readFile: ReadFile = (file: string) => {
    const resolvedFile = path.resolve(file);
    const document = vscode.workspace.textDocuments.find(item => path.resolve(item.uri.fsPath) === resolvedFile);

    return document?.getText() ?? fs.readFileSync(resolvedFile, "utf8");
  };

  private static log(entry: {
    rootFile: string;
    changedFile: string;
    triggered: boolean;
    durationMs: number;
  }) {
    this.output ??= vscode.window.createOutputChannel("Device Tree Preview");
    this.output.appendLine([
      `root DTS: ${entry.rootFile}`,
      `changed file: ${entry.changedFile}`,
      `rebuild triggered: ${entry.triggered}`,
      `rebuild duration: ${entry.durationMs}ms`,
    ].join(" | "));
  }
}
