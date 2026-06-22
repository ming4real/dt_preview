import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';
import { resolveIncludesWithDiagnostics } from '../dts/includeResolver';
import { parseDts, parseDtsChunks } from '../dts/parser';
import { mergeTrees } from '../dts/merger';
import { DtNode } from '../dts/types';
import { renderHtml } from '../preview/renderHtml';

function merge(text: string): DtNode {
	return mergeTrees(parseDts(text, '/test.dts'));
}

function child(node: DtNode, name: string, unitAddress?: string): DtNode {
	const found = node.children.find(item => item.name === name && item.unitAddress === unitAddress);
	assert.ok(found, `Expected child ${name}${unitAddress ? `@${unitAddress}` : ''}`);
	return found;
}

function prop(node: DtNode, name: string): string | undefined {
	return node.properties.find(item => item.name === name)?.value;
}

function withFiles(files: Record<string, string>, run: (dir: string) => void) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtbe-test-'));

	try {
		for (const [name, text] of Object.entries(files)) {
			const file = path.join(dir, name);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
		}

		run(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function mergeFile(entryFile: string): DtNode {
	const { chunks, diagnostics } = resolveIncludesWithDiagnostics(entryFile);
	const parsed = parseDtsChunks(chunks, entryFile);
	parsed.diagnostics = diagnostics;

	return mergeTrees(parsed);
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('merges multiple root blocks into one root', () => {
		const root = merge(`
/ {
	model = "a";
};
/ {
	compatible = "b";
};
`);

		assert.strictEqual(root.children.filter(item => item.name === '/').length, 0);
		assert.strictEqual(prop(root, 'model'), '"a"');
		assert.strictEqual(prop(root, 'compatible'), '"b"');
	});

	test('patches a labeled node with a label reference', () => {
		const root = merge(`
/ {
	soc {
		uart0: serial@1000 {
			status = "disabled";
		};
	};
};
&uart0 {
	status = "okay";
};
`);

		const uart = child(child(root, 'soc'), 'serial', '1000');
		assert.strictEqual(uart.label, 'uart0');
		assert.strictEqual(prop(uart, 'status'), '"okay"');
	});

	test('parses labeled nodes with display labels', () => {
		const root = parseDts(`
/ {
	uart0: serial@40002000 {
		status = "okay";
	};
};
`, '/test.dts');

		const serial = child(child(root, '/'), 'serial', '40002000');
		assert.strictEqual(serial.label, 'uart0');
		assert.deepStrictEqual(serial.labels, ['uart0']);
	});

	test('applies overlay fragments by target label', () => {
		const root = merge(`
/ {
	i2c0: i2c@1000 {
		status = "disabled";
	};
};
fragment@0 {
	target = <&i2c0>;
	__overlay__ {
		status = "okay";
		clock-frequency = <400000>;
	};
};
`);

		const i2c = child(root, 'i2c', '1000');
		assert.strictEqual(prop(i2c, 'status'), '"okay"');
		assert.strictEqual(prop(i2c, 'clock-frequency'), '< 400000 >');
		assert.strictEqual(root.children.some(item => item.name === 'fragment'), false);
	});

	test('applies overlay fragments by target path', () => {
		const root = merge(`
/ {
	soc {
		i2c@1000 {
			status = "disabled";
		};
	};
};
fragment@1 {
	target-path = "/soc/i2c@1000";
	__overlay__ {
		status = "okay";
	};
};
`);

		const i2c = child(child(root, 'soc'), 'i2c', '1000');
		assert.strictEqual(prop(i2c, 'status'), '"okay"');
	});

	test('overwrites repeated properties with later definitions', () => {
		const root = merge(`
/ {
	node {
		status = "disabled";
	};
};
/ {
	node {
		status = "okay";
	};
};
`);

		const node = child(root, 'node');
		assert.strictEqual(prop(node, 'status'), '"okay"');
		assert.strictEqual(node.properties.filter(item => item.name === 'status').length, 1);
	});

	test('merges repeated child nodes instead of duplicating', () => {
		const root = merge(`
/ {
	soc {
		i2c@1000 {
			status = "disabled";
		};
	};
};
/ {
	soc {
		i2c@1000 {
			clock-frequency = <100000>;
		};
	};
};
`);

		const soc = child(root, 'soc');
		assert.strictEqual(root.children.filter(item => item.name === 'soc').length, 1);
		assert.strictEqual(soc.children.filter(item => item.name === 'i2c' && item.unitAddress === '1000').length, 1);
		assert.strictEqual(prop(child(soc, 'i2c', '1000'), 'clock-frequency'), '< 100000 >');
	});

	test('makes labels from earlier files available to later patches', () => {
		const root = merge(`
/ {
	uart0: serial@1000 {
		status = "disabled";
	};
};
&uart0 {
	current-speed = <115200>;
};
`);

		const serial = child(root, 'serial', '1000');
		assert.strictEqual(serial.label, 'uart0');
		assert.strictEqual(prop(serial, 'current-speed'), '< 115200 >');
	});

	test('preserves target labels after merging label overlays', () => {
		const root = merge(`
/ {
	uart0: serial@40002000 {
		status = "okay";
	};
};
&uart0 {
	current-speed = <115200>;
};
`);

		const serial = child(root, 'serial', '40002000');
		const html = renderHtml(root);

		assert.strictEqual(serial.label, 'uart0');
		assert.strictEqual(prop(serial, 'status'), '"okay"');
		assert.strictEqual(prop(serial, 'current-speed'), '< 115200 >');
		assert.ok(html.includes('<span class="label">uart0:</span> <span class="node-name">serial@40002000</span> {'));
	});

	test('does not overwrite an existing target display label during merge', () => {
		const root = merge(`
/ {
	uart0: serial@40002000 {
		status = "disabled";
	};
};
/ {
	other_uart: serial@40002000 {
		status = "okay";
	};
};
`);

		const serial = child(root, 'serial', '40002000');
		assert.strictEqual(serial.label, 'uart0');
		assert.deepStrictEqual(serial.labels, ['uart0', 'other_uart']);
	});

	test('renders labeled and unlabeled nodes', () => {
		const root = merge(`
/ {
	uart0: serial@40002000 {};
	gpio@5000 {};
};
`);
		const html = renderHtml(root);

		assert.ok(html.includes('<span class="label">uart0:</span> <span class="node-name">serial@40002000</span> {'));
		assert.ok(html.includes('<span class="node-name">gpio@5000</span> {'));
		assert.ok(!html.includes('<span class="label">undefined:</span>'));
	});

	test('handles missing display labels while parsing and rendering', () => {
		const root = merge(`
/ {
	serial@40002000 {
		status = "okay";
	};
};
`);
		const serial = child(root, 'serial', '40002000');

		assert.strictEqual(serial.label, undefined);
		assert.doesNotThrow(() => renderHtml(root));
	});

	test('renders deleted properties as greyed out with deletion comments', () => {
		const root = merge(`
/ {
	node {
		status = "okay";
		/delete-property/ status;
	};
};
`);
		const node = child(root, 'node');
		const status = node.properties.find(item => item.name === 'status');
		const html = renderHtml(root);

		assert.strictEqual(status?.deletedBy?.file, '/test.dts');
		assert.strictEqual(status?.deletedBy?.startLine, 5);
		assert.ok(html.includes('/* deleted by /test.dts:5 */'));
		assert.ok(html.includes('<div class="prop deleted"'));
		assert.ok(html.includes('<span class="prop-name">status</span>'));
	});

	test('renders deleted child nodes as greyed out', () => {
		const root = merge(`
/ {
	parent {
		old_node {
			status = "disabled";
		};
		/delete-node/ old_node;
	};
};
`);
		const oldNode = child(child(root, 'parent'), 'old_node');
		const html = renderHtml(root);

		assert.strictEqual(oldNode.deletedBy?.startLine, 7);
		assert.ok(html.includes('/* deleted by /test.dts:7 */'));
		assert.ok(html.includes('<div class="node deleted"'));
		assert.ok(html.includes('<span class="node-name">old_node</span> {'));
		assert.ok(html.includes('<div class="prop deleted"'));
	});

	test('renders nodes deleted by label as greyed out', () => {
		const root = merge(`
/ {
	old_label: old_node {
		status = "disabled";
	};
};
/delete-node/ &old_label;
`);
		const oldNode = child(root, 'old_node');
		const html = renderHtml(root);

		assert.strictEqual(oldNode.deletedBy?.startLine, 7);
		assert.ok(html.includes('/* deleted by /test.dts:7 */'));
		assert.ok(html.includes('<span class="label">old_label:</span> <span class="node-name">old_node</span> {'));
		assert.ok(html.includes('<div class="node deleted"'));
	});

	test('deletion comments include source file and line number', () => {
		const root = merge(`
/ {
	node {
		status = "okay";
		/delete-property/ status;
		/delete-property/ status;
	};
};
`);
		const status = child(root, 'node').properties.find(item => item.name === 'status');
		const html = renderHtml(root);

		assert.strictEqual(status?.deletedBy?.file, '/test.dts');
		assert.strictEqual(status?.deletedBy?.startLine, 5);
		assert.ok(html.includes('/* deleted by /test.dts:5 */'));
		assert.ok(!html.includes('/* deleted by /test.dts:6 */'));
	});

	test('deletion from an overlay marks included base content as deleted', () => {
		withFiles({
			'main.dts': [
				'#include "base.dtsi"',
				'/ {',
				'	node {',
				'		/delete-property/ status;',
				'	};',
				'};',
			].join('\n'),
			'base.dtsi': [
				'/ {',
				'	node {',
				'		status = "okay";',
				'	};',
				'};',
			].join('\n'),
		}, dir => {
			const root = mergeFile(path.join(dir, 'main.dts'));
			const status = child(root, 'node').properties.find(item => item.name === 'status');
			const html = renderHtml(root);
			const mainFile = path.join(dir, 'main.dts');
			const baseFile = path.join(dir, 'base.dtsi');

			assert.strictEqual(status?.source.file, baseFile);
			assert.strictEqual(status?.deletedBy?.file, mainFile);
			assert.strictEqual(status?.deletedBy?.startLine, 4);
			assert.ok(html.includes(`/* deleted by ${mainFile}:4 */`));
			assert.ok(html.includes(`${baseFile}:3`));
			assert.ok(html.includes('<div class="prop deleted"'));
		});
	});

	test('missing delete targets only warn', () => {
		const root = merge(`
/ {
	node {
		/delete-property/ missing-property;
		/delete-node/ missing-node;
	};
};
/delete-node/ &missing_label;
`);

		assert.ok(root.diagnostics?.some(item => item.message === 'Delete target not found: missing-property'));
		assert.ok(root.diagnostics?.some(item => item.message === 'Delete target not found: missing-node'));
		assert.ok(root.diagnostics?.some(item => item.message === 'Delete target not found: &missing_label'));
		assert.doesNotThrow(() => renderHtml(root));
	});

	test('reports unresolved labels as warnings', () => {
		const root = merge(`
&missing {
	status = "okay";
};
fragment@0 {
	target = <&also_missing>;
	__overlay__ {
		status = "okay";
	};
};
fragment@1 {
	target-path = "/missing/path";
	__overlay__ {
		status = "okay";
	};
};
`);

		assert.ok(root.diagnostics?.some(item => item.message.includes('&missing')));
		assert.ok(root.diagnostics?.some(item => item.message.includes('&also_missing')));
		assert.ok(root.diagnostics?.some(item => item.message.includes('/missing/path')));
	});

	test('resolves an existing include file', () => {
		withFiles({
			'main.dts': '#include "base.dtsi"\n/ { main-node {}; };\n',
			'base.dtsi': '/ { included-node { status = "okay"; }; };\n',
		}, dir => {
			const root = mergeFile(path.join(dir, 'main.dts'));

			assert.strictEqual(root.diagnostics?.length, 0);
			assert.strictEqual(prop(child(root, 'included-node'), 'status'), '"okay"');
			child(root, 'main-node');
		});
	});

	test('reports a missing include file as a warning', () => {
		withFiles({
			'main.dts': '#include "no_file.dtsi"\n/ { surviving-node {}; };\n',
		}, dir => {
			const missingPath = path.join(dir, 'no_file.dtsi');
			const root = mergeFile(path.join(dir, 'main.dts'));

			child(root, 'surviving-node');
			assert.ok(root.diagnostics?.some(item => item.message === `Included file not found: ${missingPath}`));
		});
	});

	test('reports a nested missing include file as a warning', () => {
		withFiles({
			'main.dts': '#include "sub/outer.dtsi"\n/ { main-node {}; };\n',
			'sub/outer.dtsi': '#include "missing.dtsi"\n/ { outer-node {}; };\n',
		}, dir => {
			const missingPath = path.join(dir, 'sub', 'missing.dtsi');
			const root = mergeFile(path.join(dir, 'main.dts'));

			child(root, 'main-node');
			child(root, 'outer-node');
			assert.ok(root.diagnostics?.some(item => item.message === `Included file not found: ${missingPath}`));
		});
	});

	test('continues through multiple includes when one is missing', () => {
		withFiles({
			'main.dts': [
				'#include "a.dtsi"',
				'#include "missing.dtsi"',
				'#include "b.dtsi"',
				'/ { main-node {}; };',
			].join('\n'),
			'a.dtsi': '/ { a-node {}; };\n',
			'b.dtsi': '/ { b-node {}; };\n',
		}, dir => {
			const missingPath = path.join(dir, 'missing.dtsi');
			const root = mergeFile(path.join(dir, 'main.dts'));

			child(root, 'a-node');
			child(root, 'b-node');
			child(root, 'main-node');
			assert.ok(root.diagnostics?.some(item => item.message === `Included file not found: ${missingPath}`));
		});
	});
});
