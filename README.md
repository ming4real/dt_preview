# Device Tree Editor (DTBE)

A Visual Studio Code extension for exploring, editing, and understanding Linux Device Trees.

DTBE provides a live preview of the fully merged Device Tree while preserving the origin of every node and property, making it easier to work with complex `.dts` and `.dtsi` hierarchies.

## Features

### Live Merged Preview

Open a Device Tree source file and view the fully resolved tree alongside the editor.

The preview:

- Resolves `/include/` directives
- Merges included files
- Applies overlays
- Resolves label references (`&label`)
- Displays the final effective Device Tree

### Source Tracking

Every node and property retains information about where it originated.

The preview uses color coding to show:

- Original `.dts` file content
- Included `.dtsi` content
- Overlay modifications
- Generated merge results

This makes it easy to understand:

- Where a setting comes from
- Which file overrides a value
- How overlays affect the final tree

### Overlay Support

Supports:

```dts
/ {
    ...
};

&uart0 {
    status = "okay";
};

&i2c0 {
    ...
};
```

Including accurate merging of:

- `/ { ... };`
- `&label { ... };`
- Multiple overlays targeting the same node

### Delete Directives

Supports:

```dts
/delete-node/ node_name;

/delete-property/ property_name;
```

Deleted content is preserved in the preview:

- Displayed in grey
- Marked as deleted
- Annotated with the location of the delete directive

Example:

```dts
/* Deleted by board.dtsi:42 */

ethernet@1000 {
    status = "disabled";
};
```

### Label Display

Node labels are displayed in the merged view.

Example:

```dts
uart0: serial@1000 {
    status = "okay";
};
```

### Missing Include Warnings

Missing include files generate warnings instead of errors.

Example:

```text
Warning: Unable to resolve include:
soc/nonexistent.dtsi
```

The preview continues rendering with the remaining files.

## Installation

### From VSIX

Install a packaged extension:

```bash
code --install-extension dtbe-x.y.z.vsix
```

Or:

1. Open Extensions
2. Click `...`
3. Select **Install from VSIX...**
4. Choose the generated `.vsix`

## Development

### Prerequisites

- Node.js
- npm
- Visual Studio Code

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run compile
```

### Run Extension

Press:

```text
F5
```

This launches a new Extension Development Host window.

Open a Device Tree file and run:

```text
DTBE: Open Preview
```

## Packaging

Install VSCE:

```bash
npm install -g @vscode/vsce
```

Create a VSIX package:

```bash
vsce package
```

This generates:

```text
dtbe-0.0.1.vsix
```

Install:

```bash
code --install-extension dtbe-0.0.1.vsix
```

## Supported Merge Operations

### Includes

```dts
/include/ "soc.dtsi"
```

### Root Merges

```dts
/ {
    chosen {
        ...
    };
};
```

### Label References

```dts
&uart0 {
    status = "okay";
};
```

### Multiple Overlay Fragments

```dts
&uart0 {
    current-speed = <115200>;
};

&uart0 {
    status = "okay";
};
```

### Delete Property

```dts
/delete-property/ status;
```

### Delete Node

```dts
/delete-node/ ethernet@1000;
```

## Known Limitations

Current focus is on providing an accurate visualization of the final Device Tree.

Potential future improvements:

- Full Device Tree grammar support
- DTS schema validation
- Cross-reference navigation
- Property value diffing
- Search and filtering
- Export merged DTS
- Live editing of merged nodes
- Device Tree Compiler integration

## License

MIT License

## Acknowledgements

Built for Linux Device Tree developers who need to understand large DTS hierarchies, overlays, and board-specific customizations without manually tracing dozens of included files.