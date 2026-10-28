import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assertNoActiveSubagents, registerProfiles } from "./profile-commands.ts";

function fixture() {
	const root = resolve(mkdtempSync(join(tmpdir(), "pi-profile-command-")));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir);
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	const path = join(agentDir, "settings.json");
	const original = { defaultProvider: "original", defaultModel: "old", defaultThinkingLevel: "medium", theme: "mine", subagents: { agentOverrides: { architect: { disabled: true }, worker: { thinking: "medium" } } } };
	writeFileSync(path, JSON.stringify(original));
	const models = [
		["openai", "gpt-6.1-sol"], ["openai", "gpt-6-luna"], ["openai", "gpt-6.1-terra"],
		["anthropic", "claude-opus-5-5"], ["anthropic", "claude-sonnet-5-5"], ["anthropic", "claude-haiku-5-5"],
	].map(([provider, id]) => ({ provider, id, reasoning: true }));
	let model = { provider: "original", id: "old", reasoning: true };
	let thinking = "high";
	let effective: any = original;
	let reloads = 0;
	let active = 0;
	let hasUI = true;
	let projectTrusted = true;
	let selected: string | undefined;
	let failSelection = false;
	let failReload = false;
	let failAppend = false;
	let clamp = false;
	let afterSelect: (() => void) | undefined;
	const entries: any[] = [];
	const events = new Map<string, Set<Function>>();
	const handlers = new Map<string, Function>();
	const commands = new Map<string, any>();
	const notifications: string[] = [];
	const selections: string[][] = [];
	const unavailable = new Set<string>();
	const bus = {
		on(name: string, handler: Function) {
			if (!events.has(name)) events.set(name, new Set());
			events.get(name)!.add(handler);
			return () => { events.get(name)!.delete(handler); };
		},
		emit(name: string, value: any) { for (const handler of events.get(name) ?? []) handler(value); },
	};
	bus.on("subagents:rpc:v1:request", (request: any) => {
		assert.equal(request.method, "status");
		bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, { success: true, data: { fleet: { totalActive: active } } });
	});
	const ctx: any = {
		cwd,
		get hasUI() { return hasUI; },
		get model() { return model; },
		scopedModels: models.map((model) => ({ model })),
		isIdle: () => true,
		isProjectTrusted: () => projectTrusted,
		waitForIdle: async () => {},
		sessionManager: { getBranch: () => entries },
		modelRegistry: {
			find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
			getAvailable: () => models,
			hasConfiguredAuth: (model: any) => !unavailable.has(`${model.provider}/${model.id}`),
		},
		ui: {
			notify: (message: string) => notifications.push(message),
			select: async (_title: string, options: string[]) => { selections.push(options); return selected; },
		},
		reload: async () => {
			reloads++;
			if (failReload) throw new Error("reload unavailable");
			effective = JSON.parse(readFileSync(path, "utf8"));
			thinking = effective.defaultThinkingLevel;
			await handlers.get("session_start")!({}, ctx);
		},
	};
	const pi: any = {
		events: bus,
		on: (name: string, handler: Function) => handlers.set(name, handler),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		getSettings: () => effective,
		getThinkingLevel: () => thinking,
		setThinkingLevel: (value: string) => { thinking = clamp && model.provider !== "original" ? "medium" : value; },
		setModel: async (value: any) => {
			if (failSelection && value.provider !== "original") return false;
			model = value;
			thinking = "medium";
			afterSelect?.();
			return true;
		},
		appendEntry: (customType: string, data: unknown) => {
			if (failAppend) throw new Error("session write failed");
			entries.push({ type: "custom", customType, data });
		},
		sendMessage: (message: any) => notifications.push(message.content),
	};
	registerProfiles(pi, { agentDir });
	return {
		pi, ctx, models, path, original, entries, handlers, commands, notifications, selections, unavailable,
		apply: (name: string) => commands.get("profile").handler(name, ctx),
		settings: () => JSON.parse(readFileSync(path, "utf8")),
		model: () => model,
		thinking: () => thinking,
		reloads: () => reloads,
		setActive: (value: number) => { active = value; },
		setUI: (value: boolean) => { hasUI = value; },
		setTrusted: (value: boolean) => { projectTrusted = value; },
		setChoice: (value: string | undefined) => { selected = value; },
		setFailSelection: () => { failSelection = true; },
		setFailReload: () => { failReload = true; },
		setFailAppend: () => { failAppend = true; },
		setClamp: () => { clamp = true; },
		afterSelect: (callback: () => void) => { afterSelect = callback; },
	};
}

test("codex and claude update current model, global defaults and future agent mappings", async () => {
	const f = fixture();
	for (const [name, parent, worker] of [["codex", "openai/gpt-6.1-sol", "openai/gpt-6.1-terra"], ["claude", "anthropic/claude-sonnet-5-5", "anthropic/claude-sonnet-5-5"]]) {
		await f.apply(name);
		const settings = f.settings();
		assert.equal(`${f.model().provider}/${f.model().id}`, parent);
		assert.equal(`${settings.defaultProvider}/${settings.defaultModel}`, parent);
		assert.equal(settings.modelProfiles.active, name);
		assert.equal(settings.subagents.agentOverrides.worker.model, worker);
		assert.equal(settings.subagents.agentOverrides.worker.thinking, "medium");
		assert.equal(settings.defaultThinkingLevel, "medium");
		assert.equal(f.thinking(), "high");
		assert.equal(settings.theme, "mine");
		assert.deepEqual(settings.subagents.agentOverrides.architect, { disabled: true });
		assert.equal(f.entries.at(-1).data.status, "ready");
		assert.ok(f.notifications.some((text) => text.includes(`Profile: ${name}`)));
	}
	assert.equal(f.reloads(), 2);
	const entry = f.entries.at(-1);
	await f.handlers.get("session_start")!({}, f.ctx);
	assert.equal(f.entries.at(-1), entry);
});

test("show/list/completions are read-only and unknown profiles fail", async () => {
	const f = fixture();
	await f.apply("");
	await f.apply("list");
	assert.match(f.notifications[0], /Last applied profile: none/);
	assert.match(f.notifications[1], /codex, claude/);
	assert.deepEqual(f.commands.get("profile").getArgumentCompletions("co"), [{ value: "codex", label: "codex" }]);
	await assert.rejects(f.apply("unknown"), /Unknown profile/);
	assert.deepEqual(f.settings(), f.original);
	assert.equal(f.reloads(), 0);
});

test("active children reject a switch before model or settings changes", async () => {
	const f = fixture();
	f.setActive(1);
	await assert.rejects(f.apply("codex"), /active or queued/);
	assert.deepEqual(f.settings(), f.original);
	assert.equal(f.model().provider, "original");
});

test("status RPC fails closed when unavailable or malformed and removes reply subscription", async () => {
	const events = new Map<string, Function>();
	const pi: any = { events: { on: (name: string, handler: Function) => { events.set(name, handler); return () => events.delete(name); }, emit: () => {} } };
	await assert.rejects(assertNoActiveSubagents(pi, 5), /Cannot verify/);
	assert.equal(events.size, 0);
	pi.events.emit = (_name: string, request: any) => events.get(`subagents:rpc:v1:reply:${request.requestId}`)!({ success: true, data: {} });
	await assert.rejects(assertNoActiveSubagents(pi, 5), /Cannot verify/);
	assert.equal(events.size, 0);
});

test("missing scoped models and credentials leave all state unchanged", async () => {
	for (const mode of ["scope", "auth"]) {
		const f = fixture();
		if (mode === "scope") f.ctx.scopedModels = [{ model: f.models[0] }];
		else f.unavailable.add("anthropic/claude-opus-5-5");
		await assert.rejects(f.apply("codex"), mode === "scope" ? /No scoped model/ : /Authentication/);
		assert.deepEqual(f.settings(), f.original);
		assert.equal(f.model().provider, "original");
		assert.equal(f.reloads(), 0);
	}
});

test("ambiguity uses UI choice, cancellation has no effects, and headless ambiguity fails", async () => {
	for (const mode of ["choice", "cancel", "headless"]) {
		const f = fixture();
		const model = { provider: "openai", id: "gpt-7-sol", reasoning: true };
		f.models.push(model);
		f.ctx.scopedModels.push({ model });
		if (mode === "choice") {
			f.setChoice("openai/gpt-7-sol");
			await f.apply("codex");
			assert.equal(f.settings().defaultModel, "gpt-7-sol");
			assert.equal(f.selections.length, 1);
		} else {
			if (mode === "headless") f.setUI(false);
			await assert.rejects(f.apply("codex"), mode === "headless" ? /interactive/ : /cancelled/);
			assert.deepEqual(f.settings(), f.original);
		}
	}
});

test("trusted project conflicts block global writes; untrusted project settings are ignored", async () => {
	const f = fixture();
	writeFileSync(join(f.ctx.cwd, ".pi", "settings.json"), '{"defaultModel":"project"}');
	await assert.rejects(f.apply("codex"), /Project defaultModel/);
	assert.deepEqual(f.settings(), f.original);
	f.setTrusted(false);
	await f.apply("codex");
	assert.equal(f.settings().modelProfiles.active, "codex");
});

test("parent selection failure and incompatible effort restore the previous session", async () => {
	for (const failure of ["selection", "effort"]) {
		const f = fixture();
		if (failure === "selection") f.setFailSelection();
		else f.setClamp();
		await assert.rejects(f.apply("codex"), failure === "selection" ? /Cannot select/ : /preserve/);
		assert.deepEqual(f.settings(), f.original);
		assert.equal(f.model().provider, "original");
		assert.equal(f.thinking(), "high");
		assert.equal(f.reloads(), 0);
	}
});

test("settings-write failure preserves concurrent changes and restores model and effort", async () => {
	const f = fixture();
	let changed = false;
	f.afterSelect(() => {
		if (changed) return;
		changed = true;
		writeFileSync(f.path, JSON.stringify({ ...f.original, theme: "concurrent" }));
	});
	await assert.rejects(f.apply("codex"), /changed during/);
	assert.equal(f.settings().theme, "concurrent");
	assert.equal(f.settings().defaultModel, "old");
	assert.equal(f.model().provider, "original");
	assert.equal(f.thinking(), "high");
});

test("session persistence failure rolls settings and model back", async () => {
	const f = fixture();
	f.setFailAppend();
	await assert.rejects(f.apply("codex"), /session write failed/);
	assert.deepEqual(f.settings(), f.original);
	assert.equal(f.model().provider, "original");
	assert.equal(f.thinking(), "high");
});

test("unsafe settings rollback still restores the previous model and effort", async () => {
	const f = fixture();
	f.pi.appendEntry = () => {
		writeFileSync(f.path, JSON.stringify({ ...f.settings(), theme: "concurrent-after-write" }));
		throw new Error("session write failed");
	};
	await assert.rejects(f.apply("codex"), /Settings recovery failed.*Backup:/);
	assert.equal(f.settings().theme, "concurrent-after-write");
	assert.equal(f.model().provider, "original");
	assert.equal(f.thinking(), "high");
});

test("reload failure is reported as saved but not activated, with a backup path", async () => {
	const f = fixture();
	f.setFailReload();
	await assert.rejects(f.apply("codex"), /settings were saved but reload failed.*profile-backups/);
	assert.equal(f.entries.at(-1).data.status, "pending");
	assert.equal(f.notifications.some((text) => text.startsWith("Profile:")), false);
});

test("startup activation errors never announce success", async () => {
	const f = fixture();
	await f.apply("codex");
	f.entries.pop();
	f.setFailSelection();
	await f.handlers.get("session_start")!({}, f.ctx);
	assert.equal(f.entries.at(-1).data.status, "failed");
	assert.match(f.notifications.at(-1)!, /activation failed/);
});

test("children do not register parent profile commands", () => {
	const saved = process.env.PI_SUBAGENT_CHILD;
	try {
		process.env.PI_SUBAGENT_CHILD = "1";
		const f = fixture();
		assert.equal(f.commands.size, 0);
		assert.equal(f.handlers.size, 0);
	} finally {
		if (saved === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = saved;
	}
});
