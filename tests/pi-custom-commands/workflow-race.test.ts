import assert from "node:assert/strict";
import test from "node:test";
import registerAgentShortcuts from "../../pi-custom-commands/agent-shortcuts.ts";

function fixture(entries: any[] = []) {
	const commands = new Map<string, any>();
	const handlers = new Map<string, Function>();
	const registeredTools = new Map<string, any>();
	const baseline = ["read", "bash", "powershell", "edit", "write", "subagent", "custom_tool"];
	let tools = [...baseline];
	let thinking = "medium";
	let failDefaults = false;
	const ctx: any = {
		hasUI: false,
		model: { provider: "test", id: "default" },
		modelRegistry: { find: () => failDefaults ? undefined : ctx.model },
		waitForIdle: async () => {},
		sessionManager: { getBranch: () => entries },
	};
	registerAgentShortcuts({
		on: (name: string, handler: Function) => handlers.set(name, handler),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerShortcut: () => {},
		registerTool: (tool: any) => registeredTools.set(tool.name, tool),
		getSettings: () => ({ defaultProvider: "test", defaultModel: "default", defaultThinkingLevel: "medium" }),
		getThinkingLevel: () => thinking,
		setThinkingLevel: (value: string) => { thinking = value; },
		getActiveTools: () => [...tools],
		getAllTools: () => [...baseline, "grep", "find", "ls", "start_implementation"].map((name) => ({ name })),
		setActiveTools: (names: string[]) => { tools = [...names]; },
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
	} as any);
	return {
		baseline, entries, handlers, ctx,
		tools: () => tools,
		apply: (mode: string) => commands.get(mode).handler("", ctx),
		handoff: () => registeredTools.get("start_implementation").execute("approval", {}, undefined, undefined, ctx),
		failDefaults: (value: boolean) => { failDefaults = value; },
	};
}

test("overlapping workflow commands cannot capture planning tools as the normal baseline", async () => {
	for (const mode of ["normal", "plan", "architect"]) {
		const f = fixture();
		await f.apply("plan");
		const results = await Promise.allSettled([f.apply("normal"), f.apply(mode)]);
		assert.equal(results[0].status, "fulfilled");
		assert.equal(results[1].status, "rejected");
		assert.match((results[1] as PromiseRejectedResult).reason.message, /switch is already in progress/);
		assert.deepEqual(f.tools(), f.baseline);
		assert.equal(f.entries.length, 2);
		await f.apply(mode);
		await f.apply("normal");
		assert.deepEqual(f.tools(), f.baseline);
	}
});

test("implementation handoff and workflow commands share the switch guard", async () => {
	for (const first of ["handoff", "command"]) {
		const f = fixture();
		await f.apply("plan");
		const results = await Promise.allSettled(first === "handoff"
			? [f.handoff(), f.apply("normal")]
			: [f.apply("normal"), f.handoff()]);
		assert.equal(results[0].status, "fulfilled");
		assert.equal(results[1].status, "rejected");
		assert.deepEqual(f.tools(), f.baseline);
		assert.equal(f.entries.length, 2);
	}
});

test("failed switches release the guard and retain plan restrictions", async () => {
	for (const first of ["handoff", "command"]) {
		const f = fixture();
		await f.apply("plan");
		f.failDefaults(true);
		await assert.rejects(first === "handoff" ? f.handoff() : f.apply("normal"), /default model/);
		assert.equal(f.tools().includes("write"), false);
		assert.equal(f.entries.at(-1).data.mode, "plan");
		f.failDefaults(false);
		await f.apply("normal");
		assert.deepEqual(f.tools(), f.baseline);
	}
});

test("reload and tree navigation repair poisoned baselines using only the selected branch", async () => {
	for (const event of ["session_start", "session_tree"]) {
		for (const mode of ["none", "plan", "architect"]) {
			const baseline = ["read", "bash", "edit", "write", "custom_tool"];
			const poisoned = ["read", "grep", "find", "ls", "subagent", "start_implementation"];
			const entry = (mode: string, tools: string[]) => ({ type: "custom", customType: "pi-parent-workflow", data: { mode, tools, thinking: "medium" } });
			const entries = [entry("plan", baseline), entry("none", poisoned), entry(mode, poisoned)];
			const original = structuredClone(entries);
			const f = fixture(entries);
			await f.handlers.get(event)!({}, f.ctx);
			assert.equal(f.tools().includes("write"), mode !== "plan");
			assert.deepEqual(entries, original);
			await f.apply("normal");
			assert.deepEqual(f.tools(), baseline);
			assert.equal(f.tools().includes("powershell"), false);
			assert.equal(f.tools().includes("start_implementation"), false);
			await f.handlers.get("session_start")!({}, f.ctx);
			assert.deepEqual(f.tools(), baseline);
		}
	}
});

test("explicit restricted baselines without the corruption signature stay restricted", async () => {
	const entries = [
		{ type: "custom", customType: "pi-parent-workflow", data: { mode: "plan", tools: ["read", "write"], thinking: "medium" } },
		{ type: "custom", customType: "pi-parent-workflow", data: { mode: "none", tools: ["read"], thinking: "medium" } },
	];
	const f = fixture(entries);
	await f.handlers.get("session_start")!({}, f.ctx);
	assert.deepEqual(f.tools(), ["read"]);
});
