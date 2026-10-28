import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerProfileDefault } from "../../pi-custom-commands/profile-default.ts";
import { registerProfiles } from "../../pi-custom-commands/profile-commands.ts";
import { applyProfileSettings, defaultProfiles, resolveProfile } from "../../pi-custom-commands/model-profiles.mjs";

function fixture(execute = false) {
	const root = mkdtempSync(join(tmpdir(), "pi-profile-default-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir);
	mkdirSync(cwd);
	const path = join(agentDir, "settings.json");
	let settings: any = { theme: "keep", defaultThinkingLevel: "medium", modelProfiles: { pendingDefault: "claude" } };
	const save = () => writeFileSync(path, JSON.stringify(settings));
	save();
	const handlers = new Map<string, Function[]>();
	const events = new Map<string, Set<Function>>();
	const commands = new Map<string, any>();
	const messages: any[] = [];
	const notifications: string[] = [];
	const pending: Promise<void>[] = [];
	const entries: any[] = [];
	let sessionId = "session-one";
	let hasUI = true;
	let idle = true;
	let queued = false;
	let auth = true;
	let model: any = { provider: "original", id: "old" };
	let thinking = "high";
	let reloads = 0;
	const models = [
		{ provider: "anthropic", id: "claude-sonnet-8-2" },
		{ provider: "anthropic", id: "claude-haiku-8-2" },
		{ provider: "openai", id: "gpt-9.3-sol" },
	];
	const bus = {
		on(name: string, handler: Function) {
			if (!events.has(name)) events.set(name, new Set());
			events.get(name)!.add(handler);
			return () => { events.get(name)!.delete(handler); };
		},
		emit(name: string, value: any) { for (const handler of events.get(name) ?? []) handler(value); },
	};
	bus.on("subagents:rpc:v1:request", (request: any) => {
		bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, { success: true, data: { fleet: { totalActive: 0 } } });
	});
	const start = async () => { for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx); };
	const ctx: any = {
		cwd,
		get hasUI() { return hasUI; },
		get model() { return model; },
		isIdle: () => idle,
		hasPendingMessages: () => queued,
		isProjectTrusted: () => false,
		waitForIdle: async () => {},
		scopedModels: models.map((model) => ({ model })),
		sessionManager: { getSessionId: () => sessionId, getBranch: () => entries },
		ui: { notify: (message: string) => notifications.push(message), select: async () => undefined },
		modelRegistry: {
			getAvailable: () => models,
			find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
			hasConfiguredAuth: () => auth,
		},
		reload: async () => {
			reloads++;
			settings = JSON.parse(readFileSync(path, "utf8"));
			await start();
		},
	};
	const pi: any = {
		events: bus,
		on(name: string, handler: Function) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name)!.push(handler);
		},
		registerCommand: (name: string, command: any) => commands.set(name, command),
		getSettings: () => settings,
		getThinkingLevel: () => thinking,
		setThinkingLevel: (level: string) => { thinking = level; },
		setModel: async (value: any) => { model = value; return true; },
		appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
		sendMessage: (message: any) => notifications.push(message.content),
		sendUserMessage: (message: string, options: any) => {
			messages.push([message, options]);
			if (execute) pending.push(commands.get("profile").handler(message.slice("/profile ".length), ctx));
		},
	};
	registerProfiles(pi, { agentDir });
	registerProfileDefault(pi, { agentDir });
	return {
		pi, ctx, start, path, settings, save, models, messages, notifications, handlers, commands,
		ready: (id = sessionId) => bus.emit("subagents:rpc:v1:ready", { version: 1, session: { sessionId: id } }),
		flush: () => Promise.all(pending),
		read: () => JSON.parse(readFileSync(path, "utf8")),
		model: () => model,
		thinking: () => thinking,
		reloads: () => reloads,
		setUI: (value: boolean) => { hasUI = value; },
		setIdle: (value: boolean) => { idle = value; },
		setQueued: (value: boolean) => { queued = value; },
		setAuth: (value: boolean) => { auth = value; },
		setSession: (value: string) => { sessionId = value; },
	};
}

test("fresh-install intent waits for both session context and matching subagents readiness", async () => {
	for (const order of ["context-first", "ready-first"]) {
		const f = fixture();
		if (order === "context-first") {
			await f.start();
			assert.equal(f.messages.length, 0);
			f.ready();
		} else {
			f.ready();
			assert.equal(f.messages.length, 0);
			await f.start();
		}
		assert.deepEqual(f.messages, [["/profile claude", { expandPromptTemplates: true }]]);
		f.ready();
		await f.start();
		assert.equal(f.messages.length, 1);
		assert.equal(f.read().modelProfiles.active, undefined);
	}
});

test("first-start activation reuses scoped resolution, persists concrete defaults and clears the intent", async () => {
	const f = fixture(true);
	await f.start();
	f.ready();
	await f.flush();
	const settings = f.read();
	assert.equal(settings.modelProfiles.active, "claude");
	assert.equal(settings.modelProfiles.pendingDefault, undefined);
	assert.equal(settings.defaultProvider, "anthropic");
	assert.equal(settings.defaultModel, "claude-sonnet-8-2");
	assert.equal(settings.subagents.agentOverrides.scout.model, "anthropic/claude-haiku-8-2");
	assert.equal(settings.subagents.agentOverrides.worker.model, "anthropic/claude-sonnet-8-2");
	assert.equal(settings.subagents.agentOverrides.reviewer.model, "openai/gpt-9.3-sol");
	assert.equal(settings.defaultThinkingLevel, "medium");
	assert.equal(f.thinking(), "high");
	assert.equal(f.model().id, "claude-sonnet-8-2");
	assert.equal(settings.theme, "keep");
	assert.equal(f.reloads(), 1);
	assert.equal(f.messages.length, 1);
	f.ready();
	await f.start();
	assert.equal(f.messages.length, 1);
});

test("missing credentials, absent scoped models and cancelled ambiguity never fabricate an active default", async () => {
	for (const mode of ["auth", "scope", "ambiguity"]) {
		const f = fixture(true);
		if (mode === "auth") f.setAuth(false);
		if (mode === "scope") f.ctx.scopedModels = [{ model: f.models[0] }];
		if (mode === "ambiguity") f.ctx.scopedModels.push({ model: { provider: "anthropic", id: "claude-sonnet-9" } });
		await f.start();
		f.ready();
		await assert.rejects(f.flush());
		assert.equal(f.read().modelProfiles.active, undefined);
		assert.equal(f.read().modelProfiles.pendingDefault, "claude");
		assert.equal(f.read().defaultModel, undefined);
		assert.equal(f.model().id, "old");
		assert.equal(f.reloads(), 0);
	}
});

test("existing selections, absent intents, headless mode and busy sessions never auto-switch", async () => {
	for (const mode of ["selected", "no-intent", "headless", "busy", "queued"]) {
		const f = fixture();
		if (mode === "selected") f.settings.modelProfiles.active = "codex";
		if (mode === "no-intent") delete f.settings.modelProfiles.pendingDefault;
		if (mode === "headless") f.setUI(false);
		if (mode === "busy") f.setIdle(false);
		if (mode === "queued") f.setQueued(true);
		f.save();
		await f.start();
		f.ready();
		assert.equal(f.messages.length, 0);
	}
});

test("stale session readiness and shutdown cannot activate another session's default", async () => {
	const f = fixture();
	await f.start();
	f.ready("stale-session");
	assert.equal(f.messages.length, 0);
	for (const handler of f.handlers.get("session_shutdown") ?? []) handler({});
	f.ready();
	assert.equal(f.messages.length, 0);
	f.setSession("session-two");
	await f.start();
	assert.equal(f.messages.length, 0);
	f.ready("session-two");
	assert.equal(f.messages.length, 1);
});

test("invalid pending defaults report an error without dispatching arbitrary commands", async () => {
	const f = fixture();
	f.settings.modelProfiles.pendingDefault = "claude\n/normal";
	f.save();
	await f.start();
	f.ready();
	assert.equal(f.messages.length, 0);
	assert.match(f.notifications[0], /Invalid first-install default/);
	f.ready();
	assert.equal(f.notifications.length, 1);
});

test("explicit profile selection always consumes a pending first-install default", async () => {
	const models = [
		{ provider: "openai", id: "gpt-9-sol" }, { provider: "openai", id: "gpt-9-luna" },
		{ provider: "openai", id: "gpt-9-terra" }, { provider: "anthropic", id: "claude-opus-8" },
	];
	const resolved = await resolveProfile(defaultProfiles.codex, models, () => undefined);
	const settings = applyProfileSettings({}, "codex", resolved, { pendingDefault: "claude" });
	assert.equal(settings.modelProfiles.active, "codex");
	assert.equal(settings.modelProfiles.pendingDefault, undefined);
});

test("profile status distinguishes a pending first-install default from an active profile", async () => {
	const f = fixture();
	await f.commands.get("profile").handler("", f.ctx);
	assert.match(f.notifications[0], /Last applied profile: none/);
	assert.match(f.notifications[0], /Pending first-install default: claude/);
	assert.equal(f.messages.length, 0);
});

test("background children do not register default activation hooks", () => {
	const saved = process.env.PI_SUBAGENT_CHILD;
	try {
		process.env.PI_SUBAGENT_CHILD = "1";
		const f = fixture();
		assert.equal(f.handlers.size, 0);
	} finally {
		if (saved === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = saved;
	}
});
