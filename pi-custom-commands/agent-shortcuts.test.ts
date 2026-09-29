import assert from "node:assert/strict";
import test from "node:test";
import registerAgentShortcuts from "./agent-shortcuts.ts";

function createTestPi() {
	const shortcuts = new Map<string, { handler: () => Promise<void> }>();
	const commands = new Map<string, { handler: () => Promise<void> }>();
	const sentMessages: Array<[string, { expandPromptTemplates: boolean }]> = [];
	const pi = {
		registerShortcut(key: string, shortcut: { handler: () => Promise<void> }) {
			shortcuts.set(key, shortcut);
		},
		registerCommand(name: string, command: { handler: () => Promise<void> }) {
			commands.set(name, command);
		},
		sendUserMessage(message: string, options: { expandPromptTemplates: boolean }) {
			sentMessages.push([message, options]);
		},
	} as any;

	registerAgentShortcuts(pi);
	return { shortcuts, commands, sentMessages };
}

test("shift+tab cycles plan, architect, review, default", async () => {
	const { shortcuts, sentMessages } = createTestPi();
	const shortcut = shortcuts.get("shift+tab")!;
	for (let i = 0; i < 5; i++) await shortcut.handler();

	assert.deepEqual(
		sentMessages.map(([message]) => message),
		["/agent plan", "/agent architect", "/agent review", "/agent default", "/agent plan"],
	);
});

test("slash commands switch to their matching agents", async () => {
	const { commands, sentMessages } = createTestPi();
	for (const mode of ["plan", "architect", "review", "default", "none"]) {
		await commands.get(mode)!.handler();
	}

	assert.deepEqual(
		sentMessages.map(([message]) => message),
		["/agent plan", "/agent architect", "/agent review", "/agent default", "/agent none"],
	);
});
