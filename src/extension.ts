import * as vscode from "vscode";
import { DeviceTreePreviewPanel } from "./preview/panel";

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand("dtbEditor.openPreview", () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("Open a .dts or .dtsi file first.");
      return;
    }

    DeviceTreePreviewPanel.show(context, editor.document.uri.fsPath);
  });

  const changeWatcher = vscode.workspace.onDidChangeTextDocument(event => {
    const file = event.document.uri.fsPath;

    if (file.endsWith(".dts") || file.endsWith(".dtsi")) {
      DeviceTreePreviewPanel.handleDocumentChange(file);
    }
  });

  context.subscriptions.push(command, changeWatcher);
}

export function deactivate() {}
