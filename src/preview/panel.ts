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
  private static activeRootDts: string | undefined;
  private static dependencyGraph = new Map<string, Set<string>>();
  private static dependencyClosure = new Set<string>();

  private static ensurePanel() {
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
        this.activeRootDts = undefined;
        this.dependencyGraph.clear();
        this.dependencyClosure.clear();
      });
    }
  }

  static show() {
    this.ensurePanel();

    if (this.activeRootDts) {
      this.update(this.activeRootDts, this.activeRootDts, "manual refresh");
      return;
    }

    this.panel!.webview.html = renderHtml({
      name: "/",
      labels: [],
      properties: [],
      children: [],
      deleteDirectives: [],
      source: {
        file: "",
        startLine: 1,
        endLine: 1,
      },
      diagnostics: [{
        severity: "warning",
        message: "No preview root selected. Run Device Tree: Preview This DTS as Root.",
      }],
    });
  }

  static previewThisDtsAsRoot(sourceFile: string): boolean {
    const rootFile = path.resolve(sourceFile);

    if (path.extname(rootFile) !== ".dts") {
      vscode.window.showErrorMessage("Select a .dts file to use as the preview root.");
      this.log({
        rootFile,
        changedFile: rootFile,
        trigger: "root selection rejected",
        durationMs: 0,
      });
      return false;
    }

    this.ensurePanel();
    this.activeRootDts = rootFile;
    this.log({
      rootFile,
      changedFile: rootFile,
      trigger: "root selection",
      durationMs: 0,
    });
    this.update(rootFile, rootFile, "root selection");

    return true;
  }

  static update(sourceFile: string, changedFile = sourceFile, trigger = "manual rebuild") {
    this.ensurePanel();

    try {
      const rootFile = path.resolve(sourceFile);
      const started = Date.now();
      const { chunks, diagnostics, dependencyGraph } = resolveIncludesWithDiagnostics(rootFile, this.readFile);
      const parsed = parseDtsChunks(chunks, rootFile);
      parsed.diagnostics = diagnostics;
      const merged = mergeTrees(parsed);

      this.dependencyGraph = dependencyGraph;
      this.dependencyClosure = collectTransitiveIncludes(rootFile, dependencyGraph);
      this.activeRootDts = rootFile;
      this.panel!.webview.html = renderHtml(merged, rootFile);
      this.log({
        rootFile,
        changedFile: path.resolve(changedFile),
        trigger,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.panel!.webview.html = `<pre>${String(error)}</pre>`;
    }
  }

  static handleDocumentChange(changedFile: string) {
    const rootFile = this.activeRootDts;
    const resolvedChangedFile = path.resolve(changedFile);

    if (!rootFile) {
      return;
    }

    const shouldRebuild = resolvedChangedFile === rootFile || this.dependencyClosure.has(resolvedChangedFile);
    const started = Date.now();

    if (shouldRebuild) {
      const trigger = resolvedChangedFile === rootFile ? "root change" : "dependency change";
      this.update(rootFile, resolvedChangedFile, trigger);
      return;
    }

    this.log({
      rootFile,
      changedFile: resolvedChangedFile,
      trigger: "unrelated change",
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
    trigger: string;
    durationMs: number;
  }) {
    this.output ??= vscode.window.createOutputChannel("Device Tree Preview");
    this.output.appendLine("[DTB Editor]");
    this.output.appendLine(`Root DTS: ${entry.rootFile}`);
    this.output.appendLine(`Changed: ${entry.changedFile}`);
    this.output.appendLine(`Trigger: ${entry.trigger}`);
    this.output.appendLine(`Rebuild: ${entry.durationMs} ms`);
  }
}
