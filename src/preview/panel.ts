import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { renderHtml } from "./renderHtml";
import { ReadFile, collectTransitiveIncludes, resolveIncludesWithDiagnostics } from "../dts/includeResolver";
import { parseDtsChunks } from "../dts/parser";
import { mergeTrees } from "../dts/merger";
import { DtDiagnostic } from "../dts/types";

export class DeviceTreePreviewPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static output: vscode.OutputChannel | undefined;
  private static activeRootDts: string | undefined;
  private static dependencyGraph = new Map<string, Set<string>>();
  private static dependencyClosure = new Set<string>();

  private static ensurePanel(extensionUri: vscode.Uri) {
    if (!this.panel) {
      const nodeModulesRoot = vscode.Uri.joinPath(extensionUri, "node_modules");
      const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");

      this.panel = vscode.window.createWebviewPanel(
        "deviceTreePreview",
        "Device Tree Preview",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [nodeModulesRoot, mediaRoot],
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.activeRootDts = undefined;
        this.dependencyGraph.clear();
        this.dependencyClosure.clear();
      });

      this.panel.webview.onDidReceiveMessage(message => {
        void this.handleWebviewMessage(message);
      });
    }
  }

  static show(extensionUri: vscode.Uri) {
    this.ensurePanel(extensionUri);

    if (this.activeRootDts) {
      this.update(this.activeRootDts, extensionUri, this.activeRootDts, "manual refresh");
      return;
    }

    const monacoBaseUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "node_modules", "monaco-editor", "min", "vs")
    );
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
    }, {
      activeFile: this.activeEditorFile(),
      cspSource: this.panel!.webview.cspSource,
      monacoBaseUri: monacoBaseUri.toString(),
      nonce: this.createNonce(),
    });
  }

  static previewThisDtsAsRoot(sourceFile: string, extensionUri: vscode.Uri): boolean {
    const rootFile = path.resolve(sourceFile);

    const allowedExtensions = new Set([".dts", ".dtsi"]);
    const ext = path.extname(rootFile).toLowerCase();

    if (!allowedExtensions.has(ext)) {
      vscode.window.showErrorMessage("Select a .dts file to use as the preview root.");
      this.log({
        rootFile,
        changedFile: rootFile,
        trigger: "root selection rejected",
        durationMs: 0,
      });
      return false;
    }

    this.ensurePanel(extensionUri);
    this.activeRootDts = rootFile;
    this.log({
      rootFile,
      changedFile: rootFile,
      trigger: "root selection",
      durationMs: 0,
    });
    this.update(rootFile, extensionUri, rootFile, "root selection");

    return true;
  }

  static update(sourceFile: string, extensionUri: vscode.Uri, changedFile = sourceFile, trigger = "manual rebuild") {
    this.ensurePanel(extensionUri);

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
      const monacoBaseUri = this.panel!.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "monaco-editor", "min", "vs")
      );
      this.panel!.webview.html = renderHtml(merged, {
        activeFile: this.activeEditorFile(),
        cspSource: this.panel!.webview.cspSource,
        includeGraph: dependencyGraph,
        monacoBaseUri: monacoBaseUri.toString(),
        nonce: this.createNonce(),
        rootFile,
      });
      this.log({
        rootFile,
        changedFile: path.resolve(changedFile),
        trigger,
        durationMs: Date.now() - started,
        diagnostics,
      });
    } catch (error) {
      this.panel!.webview.html = `<pre>${String(error)}</pre>`;
    }
  }

  static handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
    const file = editor ? path.resolve(editor.document.uri.fsPath) : undefined;

    void this.panel?.webview.postMessage({
      command: "activeFile",
      file,
    });
  }

  static handleDocumentChange(changedFile: string, extensionUri: vscode.Uri) {
    const rootFile = this.activeRootDts;
    const resolvedChangedFile = path.resolve(changedFile);

    if (!rootFile) {
      return;
    }

    const shouldRebuild = resolvedChangedFile === rootFile || this.dependencyClosure.has(resolvedChangedFile);
    const started = Date.now();

    if (shouldRebuild) {
      const trigger = resolvedChangedFile === rootFile ? "root change" : "dependency change";
      this.update(rootFile, extensionUri, resolvedChangedFile, trigger);
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

  private static activeEditorFile(): string | undefined {
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;

    return file ? path.resolve(file) : undefined;
  }

  private static async handleWebviewMessage(message: unknown) {
    if (!message || typeof message !== "object" || !("command" in message)) {
      return;
    }

    if (message.command === "openFile" && "file" in message && typeof message.file === "string") {
      const file = message.file;
      const uri = vscode.Uri.file(file);
      let doc: vscode.TextDocument;

      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch (error) {
        vscode.window.showErrorMessage(`Unable to open ${file}: ${String(error)}`);
        return;
      }

      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
      });
    }
  }

  private static log(entry: {
    rootFile: string;
    changedFile: string;
    trigger: string;
    durationMs: number;
    diagnostics?: DtDiagnostic[];
  }) {
    this.output ??= vscode.window.createOutputChannel("Device Tree Preview");
    this.output.appendLine("[DTB Editor]");
    this.output.appendLine(`Root DTS: ${entry.rootFile}`);
    this.output.appendLine(`Changed: ${entry.changedFile}`);
    this.output.appendLine(`Trigger: ${entry.trigger}`);
    this.output.appendLine(`Rebuild: ${entry.durationMs} ms`);
    for (const diagnostic of entry.diagnostics ?? []) {
      this.output.appendLine(`${diagnostic.severity}: ${diagnostic.message}`);
    }
  }

  private static createNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";

    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return nonce;
  }
}
