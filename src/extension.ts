import * as vscode from "vscode";
import { DeviceTreePreviewPanel } from "./preview/panel";

export function activate(context: vscode.ExtensionContext) {
  function previewActiveEditorAsRoot() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("Open a .dts file first.");
      return;
    }

    DeviceTreePreviewPanel.previewThisDtsAsRoot(editor.document.uri.fsPath, context.extensionUri);
  }

  const previewRoot = vscode.commands.registerCommand("dtbEditor.previewThisDtsAsRoot", previewActiveEditorAsRoot);
  const useActiveEditorAsRoot = vscode.commands.registerCommand("dtbEditor.useActiveEditorAsRoot", previewActiveEditorAsRoot);

  const changeWatcher = vscode.workspace.onDidChangeTextDocument(event => {
    const file = event.document.uri.fsPath;

    if (file.endsWith(".dts") || file.endsWith(".dtsi")) {
      DeviceTreePreviewPanel.handleDocumentChange(file, context.extensionUri);
    }
  });

  context.subscriptions.push(previewRoot, useActiveEditorAsRoot, changeWatcher);
}

export function deactivate() {}
