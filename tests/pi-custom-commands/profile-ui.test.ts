import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import registerAgentShortcuts from "../../pi-custom-commands/agent-shortcuts.ts";
import { registerProfileShortcuts } from "../../pi-custom-commands/profile-shortcuts.ts";

function workflowFixture(active?: unknown, hasUI = true) {
	const settings: any = { modelProfiles: { active } };
	const handlers = new Map<string, Function>();
	const commands = new Map<string, any>();
	const widgets = new Map<string, any>();
	const entries: any[] = [];
	let tools = ["read", "write", "bash"];
	let thinking = "medium";
	const ctx: any = {
		hasUI,
		ui: { setWidget: (key: string, content: string[], options: any) => widgets.set(key, { content, ...options }) },
		sessionManager: { getBranch: () => entries },
		waitForIdle: async () => {},
	};
	const pi: any = {
		on: (name: string, handler: Function) => handlers.set(name, handler),
		getSettings: () => settings,
		getActiveTools: () => [...tools],
		getAllTools: () => ["read", "write", "bash", "start_implementation"].map((name) => ({ name })),
		setActiveTools: (names: string[]) => { tools = names; },
		getThinkingLevel: () => thinking,
		setThinkingLevel: (level: string) => { thinking = level; },
		registerTool: () => {},
		registerShortcut: () => {},
		registerCommand: (name: string, command: any) => commands.set(name, command),
		appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
	};
	registerAgentShortcuts(pi);
	return { ctx, settings, handlers, commands, widgets, entries };
}

test("selected profile shares the existing above-editor workflow widget", async () => {
	const f = workflowFixture("codex");
	await f.handlers.get("session_start")!({}, f.ctx);
	assert.deepEqual(f.widgets.get("pi-parent-workflow"), { content: ["Workflow: normal | Profile: codex"], placement: "aboveEditor" });
	for (const mode of ["plan", "architect", "normal"]) {
		await f.commands.get(mode).handler("", f.ctx);
		assert.deepEqual(f.widgets.get("pi-parent-workflow").content, [`Workflow: ${mode} | Profile: codex`]);
	}
	assert.equal(f.widgets.size, 1);
});

test("profile label refreshes from settings on reload, resume and tree navigation", async () => {
	const f = workflowFixture("codex");
	await f.handlers.get("session_start")!({}, f.ctx);
	f.settings.modelProfiles.active = "claude";
	f.widgets.clear();
	await f.handlers.get("session_start")!({}, f.ctx);
	assert.deepEqual(f.widgets.get("pi-parent-workflow").content, ["Workflow: normal | Profile: claude"]);
	await f.commands.get("plan").handler("", f.ctx);
	f.settings.modelProfiles.active = "custom";
	await f.handlers.get("session_tree")!({}, f.ctx);
	assert.deepEqual(f.widgets.get("pi-parent-workflow").content, ["Workflow: plan | Profile: custom"]);
	f.entries.length = 0;
	await f.handlers.get("session_tree")!({}, f.ctx);
	assert.deepEqual(f.widgets.get("pi-parent-workflow").content, ["Workflow: normal | Profile: custom"]);
});

test("unselected or malformed active profiles preserve the original workflow label", async () => {
	for (const active of [undefined, null, "", "   ", 42]) {
		const f = workflowFixture(active);
		await f.handlers.get("session_start")!({}, f.ctx);
		assert.deepEqual(f.widgets.get("pi-parent-workflow").content, ["Workflow: normal"]);
	}
	const f = workflowFixture("codex", false);
	await f.handlers.get("session_start")!({}, f.ctx);
	assert.equal(f.widgets.size, 0);
});

function shortcutsFixture() {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-profile-shortcuts-"));
	const path = join(agentDir, "settings.json");
	const settings: any = { modelProfiles: { profiles: { custom: {} } } };
	const save = () => writeFileSync(path, JSON.stringify(settings));
	save();
	const shortcuts = new Map<string, any>();
	const messages: any[] = [];
	const notifications: string[] = [];
	const pi: any = {
		registerShortcut: (key: string, shortcut: any) => shortcuts.set(key, shortcut),
		sendUserMessage: (message: string, options: any) => messages.push([message, options]),
	};
	const ctx: any = { isIdle: () => true, hasUI: true, ui: { notify: (message: string) => notifications.push(message) } };
	registerProfileShortcuts(pi, { agentDir });
	return { pi, ctx, agentDir, path, settings, save, shortcuts, messages, notifications };
}

test("up/down cycle dynamic profile names with wraparound through the profile command", async () => {
	const f = shortcutsFixture();
	for (const [key, active, next] of [
		["ctrl+shift+up", "codex", "claude"],
		["ctrl+shift+up", "claude", "custom"],
		["ctrl+shift+up", "custom", "codex"],
		["ctrl+shift+down", "codex", "custom"],
		["ctrl+shift+down", "custom", "claude"],
		["ctrl+shift+down", "claude", "codex"],
	]) {
		f.settings.modelProfiles.active = active;
		f.save();
		await f.shortcuts.get(key).handler(f.ctx);
		assert.deepEqual(f.messages.at(-1), [`/profile ${next}`, { expandPromptTemplates: true }]);
		assert.equal(JSON.parse(readFileSync(f.path, "utf8")).modelProfiles.active, active);
	}
	assert.equal(f.shortcuts.size, 2);
});

test("no active or removed profile enters the first/last profile and new definitions are picked up", async () => {
	const f = shortcutsFixture();
	for (const active of [undefined, "removed"]) {
		f.settings.modelProfiles.active = active;
		f.save();
		await f.shortcuts.get("ctrl+shift+up").handler(f.ctx);
		assert.equal(f.messages.at(-1)[0], "/profile codex");
		await f.shortcuts.get("ctrl+shift+down").handler(f.ctx);
		assert.equal(f.messages.at(-1)[0], "/profile custom");
	}
	f.settings.modelProfiles.profiles.added = {};
	f.settings.modelProfiles.active = "custom";
	f.save();
	await f.shortcuts.get("ctrl+shift+up").handler(f.ctx);
	assert.equal(f.messages.at(-1)[0], "/profile added");
});

test("profile shortcuts do not dispatch during active turns, including headless sessions", async () => {
	const f = shortcutsFixture();
	for (const key of ["ctrl+shift+up", "ctrl+shift+down"]) {
		await f.shortcuts.get(key).handler({ ...f.ctx, isIdle: () => false });
		await f.shortcuts.get(key).handler({ ...f.ctx, hasUI: false, isIdle: () => false });
	}
	assert.equal(f.messages.length, 0);
	assert.equal(f.notifications.length, 2);
});

test("reserved and multiline profile names cannot turn a shortcut into another command", async () => {
	const f = shortcutsFixture();
	Object.assign(f.settings.modelProfiles.profiles, { list: {}, "": {}, " spaced ": {}, "bad\n/normal": {} });
	f.settings.modelProfiles.active = "custom";
	f.save();
	await f.shortcuts.get("ctrl+shift+up").handler(f.ctx);
	assert.equal(f.messages.at(-1)[0], "/profile codex");
});

test("background children do not register profile cycling shortcuts", () => {
	const saved = process.env.PI_SUBAGENT_CHILD;
	try {
		process.env.PI_SUBAGENT_CHILD = "1";
		assert.equal(shortcutsFixture().shortcuts.size, 0);
	} finally {
		if (saved === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = saved;
	}
});
