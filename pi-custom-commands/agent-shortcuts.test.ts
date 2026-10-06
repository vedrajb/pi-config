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

test("shift+tab shortcut is not registered", () => {
	const { shortcuts } = createTestPi();
	assert.equal(shortcuts.has("shift+tab"), false);
});

test("slash commands switch to their matching agents", async () => {
	const { commands, sentMessages } = createTestPi();
	for (const mode of ["plan", "architect", "none"]) {
		await commands.get(mode)!.handler();
	}

	assert.deepEqual(
		sentMessages.map(([message]) => message),
		["/agent plan", "/agent architect", "/agent none"],
	);
});

test("default agent command is not registered", () => {
	const { commands } = createTestPi();
	assert.equal(commands.has("default"), false);
});

test("review agent command is not registered", () => {
	const { commands } = createTestPi();
	assert.equal(commands.has("review"), false);
});
