import * as vscode from "vscode";
import { renderHtml } from "./renderHtml";
import { resolveIncludes, buildExpandedText } from "../dts/includeResolver";
import { parseDts } from "../dts/parser";
import { mergeTrees } from "../dts/merger";

export class DeviceTreePreviewPanel {
  private static panel: vscode.WebviewPanel | undefined;

  static show(context: vscode.ExtensionContext, sourceFile: string) {
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
      });
    }

    this.update(sourceFile);
  }

  static update(sourceFile: string) {
    if (!this.panel) {
      return;
    }

    try {
      const chunks = resolveIncludes(sourceFile);
      const expanded = buildExpandedText(chunks);
      const parsed = parseDts(expanded, sourceFile);
      const merged = mergeTrees(parsed);

      this.panel.webview.html = renderHtml(merged);
    } catch (error) {
      this.panel.webview.html = `<pre>${String(error)}</pre>`;
    }
  }
}