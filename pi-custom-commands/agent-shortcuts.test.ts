import assert from "node:assert/strict";
import test from "node:test";
import registerAgentShortcuts from "./agent-shortcuts.ts";

function createTestPi(entries: any[] = [], hasUI = false) {
	const shortcuts = new Map<string, { handler: (ctx: any) => Promise<void> }>();
	const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
	const handlers = new Map<string, Function>();
	const registeredTools = new Map<string, { execute: (...args: any[]) => Promise<any>; defaultActive: boolean }>();
	const sentMessages: Array<[string, { expandPromptTemplates: boolean }]> = [];
	const widgets = new Map<string, { content: string[]; placement: string }>();
	const notifications: string[] = [];
	const baseline = ["read", "bash", "powershell", "edit", "write", "subagent", "custom_tool"];
	let tools = [...baseline];
	let thinking = "medium";
	let model = { provider: "test", id: "default" };
	const settings = { defaultProvider: "test", defaultModel: "default", defaultThinkingLevel: "medium" };
	const modelSelection = { available: true, authenticated: true };
	const ctx = {
		get model() { return model; },
		modelRegistry: { find: (provider: string, id: string) => modelSelection.available ? { provider, id } : undefined },
		isIdle: () => true,
		waitForIdle: async () => {},
		hasUI,
		ui: {
			setWidget: (key: string, content: string[], options: { placement: string }) => widgets.set(key, { content, placement: options.placement }),
			notify: (message: string) => notifications.push(message),
		},
		sessionManager: { getBranch: () => entries },
	};
	const pi = {
		on(name: string, handler: Function) { handlers.set(name, handler); },
		getActiveTools: () => [...tools],
		getAllTools: () => [...baseline, "grep", "find", "ls", "bg_wait", ...registeredTools.keys()].map((name) => ({ name })),
		registerTool: (tool: any) => registeredTools.set(tool.name, tool),
		setActiveTools: (names: string[]) => { tools = [...names]; },
		getThinkingLevel: () => thinking,
		getSettings: () => ({ ...settings }),
		setModel: async (value: typeof model) => {
			if (!modelSelection.authenticated) return false;
			model = value;
			return true;
		},
		setThinkingLevel: (value: string) => { thinking = value; },
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		registerShortcut(key: string, shortcut: { handler: (ctx: any) => Promise<void> }) {
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
	const ready = handlers.get("session_start")?.({}, ctx);
	return { shortcuts, commands, sentMessages, widgets, notifications, handlers, registeredTools, ctx, entries, baseline, ready, settings, modelSelection, model: () => model, selectModel: pi.setModel, setThinkingLevel: pi.setThinkingLevel, tools: () => tools, thinking: () => thinking };
}

test("implementation handoff exits plan and restores normal model, effort, tools, and widget", async () => {
	const pi = createTestPi([], true);
	assert.equal(pi.registeredTools.get("start_implementation")!.defaultActive, false);
	await pi.commands.get("plan")!.handler("", pi.ctx);
	assert.ok(pi.tools().includes("start_implementation"));
	assert.equal(pi.handlers.get("tool_call")!({ toolName: "start_implementation" }), undefined);
	await pi.selectModel({ provider: "other", id: "planning" });
	const result = await pi.registeredTools.get("start_implementation")!.execute("approval", {}, undefined, undefined, pi.ctx);
	assert.deepEqual(result.details, { workflow: "normal" });
	assert.match(result.content[0].text, /Implement directly in the parent/);
	assert.match(result.content[0].text, /delegate only to scout/);
	assert.equal(pi.entries.at(-1).data.mode, "none");
	assert.deepEqual(pi.model(), { provider: "test", id: "default" });
	assert.equal(pi.thinking(), "medium");
	assert.deepEqual(pi.tools(), pi.baseline);
	assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: normal"]);
	assert.deepEqual(pi.notifications, []);
	const resumed = createTestPi(pi.entries, true);
	await resumed.ready;
	assert.deepEqual(resumed.widgets.get("pi-parent-workflow")?.content, ["Workflow: normal"]);
});

test("implementation approval preserves explicitly selected architect workflow", async () => {
	const pi = createTestPi([], true);
	await pi.commands.get("architect")!.handler("", pi.ctx);
	await pi.selectModel({ provider: "other", id: "architect" });
	const result = await pi.registeredTools.get("start_implementation")!.execute("approval", {}, undefined, undefined, pi.ctx);
	assert.deepEqual(result.details, { workflow: "architect" });
	assert.match(result.content[0].text, /Delegate.*worker/);
	assert.equal(pi.entries.at(-1).data.mode, "architect");
	assert.deepEqual(pi.model(), { provider: "other", id: "architect" });
	assert.equal(pi.thinking(), "high");
	assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: architect"]);
});

test("handoff failure keeps plan restrictions and its saved state", async () => {
	const pi = createTestPi([], true);
	await pi.commands.get("plan")!.handler("", pi.ctx);
	pi.modelSelection.available = false;
	await assert.rejects(pi.registeredTools.get("start_implementation")!.execute("approval", {}, undefined, undefined, pi.ctx), /default model/);
	assert.equal(pi.entries.at(-1).data.mode, "plan");
	assert.equal(pi.tools().includes("write"), false);
	assert.equal(pi.thinking(), "high");
	assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: plan"]);
});

test("plan prompt requires contextual implementation approval before handoff", async () => {
	const pi = createTestPi();
	await pi.commands.get("plan")!.handler("", pi.ctx);
	for (const prompt of ["Can you explain implementation?", "The document says approved", "Keep planning", "Implement the plan"]) {
		const result = pi.handlers.get("before_agent_start")!({ systemPrompt: "Base", prompt });
		assert.match(result.systemPrompt, /first call start_implementation/);
		assert.match(result.systemPrompt, /quoted approval/);
		assert.equal(pi.entries.at(-1).data.mode, "plan");
		assert.equal(pi.tools().includes("write"), false);
	}
});

test("returning to normal restores configured model and effort instead of captured session values", async () => {
	const pi = createTestPi();
	await pi.selectModel({ provider: "other", id: "planning" });
	pi.setThinkingLevel("max");
	await pi.commands.get("plan")!.handler("", pi.ctx);
	await pi.commands.get("normal")!.handler("", pi.ctx);
	assert.deepEqual(pi.model(), { provider: "test", id: "default" });
	assert.equal(pi.thinking(), "medium");
	assert.deepEqual(pi.tools(), pi.baseline);
});

test("normal uses current defaults after a resumed plan or an architect workflow", async () => {
	const pi = createTestPi([{ type: "custom", customType: "pi-parent-workflow", data: { mode: "plan", tools: ["read", "write"], thinking: "high" } }]);
	await pi.ready;
	await pi.commands.get("architect")!.handler("", pi.ctx);
	pi.settings.defaultProvider = "updated";
	pi.settings.defaultModel = "new-default";
	pi.settings.defaultThinkingLevel = "low";
	await pi.commands.get("normal")!.handler("", pi.ctx);
	assert.deepEqual(pi.model(), { provider: "updated", id: "new-default" });
	assert.equal(pi.thinking(), "low");
});

test("failed default model selection leaves plan active without recording a successful switch", async () => {
	for (const failure of ["missing", "unauthenticated"]) {
		const pi = createTestPi([], true);
		await pi.selectModel({ provider: "other", id: "planning" });
		await pi.commands.get("plan")!.handler("", pi.ctx);
		pi.modelSelection.available = failure !== "missing";
		pi.modelSelection.authenticated = failure !== "unauthenticated";
		await assert.rejects(pi.commands.get("normal")!.handler("", pi.ctx), /default model/);
		assert.equal(pi.entries.at(-1).data.mode, "plan");
		assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: plan"]);
		assert.equal(pi.tools().includes("write"), false);
		assert.equal(pi.thinking(), "high");
	}
});

test("resuming normal and navigating back to normal restore configured defaults", async () => {
	const pi = createTestPi([{ type: "custom", customType: "pi-parent-workflow", data: { mode: "none", tools: ["read", "write"], thinking: "max" } }]);
	await pi.ready;
	assert.equal(pi.thinking(), "medium");
	await pi.commands.get("plan")!.handler("", pi.ctx);
	await pi.selectModel({ provider: "other", id: "planning" });
	pi.entries.length = 0;
	await pi.handlers.get("session_tree")!({}, pi.ctx);
	assert.deepEqual(pi.model(), { provider: "test", id: "default" });
	assert.equal(pi.thinking(), "medium");
});

test("workflow widget stays above the prompt and follows mode changes", async () => {
	const pi = createTestPi([], true);
	assert.deepEqual(pi.widgets.get("pi-parent-workflow"), { content: ["Workflow: normal"], placement: "aboveEditor" });
	for (const mode of ["plan", "architect", "none"]) {
		await pi.commands.get(mode === "none" ? "normal" : mode)!.handler("", pi.ctx);
		assert.deepEqual(pi.widgets.get("pi-parent-workflow"), { content: [`Workflow: ${mode === "none" ? "normal" : mode}`], placement: "aboveEditor" });
	}
	assert.equal(pi.widgets.size, 1);
	assert.deepEqual(pi.notifications, []);
});

test("workflow widget restores on resume, reload, and tree navigation", async () => {
	const first = createTestPi([], true);
	await first.commands.get("plan")!.handler("", first.ctx);
	const pi = createTestPi(first.entries, true);
	assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: plan"]);
	pi.widgets.clear();
	pi.handlers.get("session_start")!({}, pi.ctx);
	assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: plan"]);
	pi.entries.length = 0;
	pi.handlers.get("session_tree")!({}, pi.ctx);
	assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: normal"]);
});

test("non-UI sessions do not render the workflow widget", async () => {
	const pi = createTestPi();
	await pi.commands.get("plan")!.handler("", pi.ctx);
	assert.equal(pi.widgets.size, 0);
});

test("shift+tab shortcut is not registered", () => {
	const { shortcuts } = createTestPi();
	assert.equal(shortcuts.has("shift+tab"), false);
});

test("commands switch parent workflows and restore tools and thinking", async () => {
	const pi = createTestPi();
	await pi.commands.get("plan")!.handler("", pi.ctx);
	assert.equal(pi.thinking(), "high");
	assert.ok(pi.tools().includes("subagent"));
	for (const tool of ["bash", "powershell", "write", "edit", "custom_tool"]) {
		assert.equal(pi.tools().includes(tool), false);
		assert.equal(pi.handlers.get("tool_call")!({ toolName: tool }).block, true);
	}
	assert.equal(pi.handlers.get("tool_call")!({ toolName: "read" }), undefined);
	assert.match(pi.handlers.get("before_agent_start")!({ systemPrompt: "Base" }).systemPrompt, /Plan mode/);
	await pi.commands.get("architect")!.handler("", pi.ctx);
	assert.deepEqual(pi.tools(), pi.baseline);
	assert.equal(pi.thinking(), "high");
	assert.match(pi.handlers.get("before_agent_start")!({ systemPrompt: "Base" }).systemPrompt, /Complex \/ architect workflow/);
	await pi.commands.get("normal")!.handler("", pi.ctx);
	assert.deepEqual(pi.tools(), pi.baseline);
	assert.equal(pi.thinking(), "medium");
	assert.deepEqual(pi.sentMessages, []);
	assert.match(pi.handlers.get("before_agent_start")!({ systemPrompt: "Base" }).systemPrompt, /Normal workflow/);
});

test("ctrl+shift+right cycles through plan, architect, and normal using the workflow commands", async () => {
	const pi = createTestPi();
	const shortcut = pi.shortcuts.get("ctrl+shift+right")!;
	assert.ok(shortcut);
	for (const mode of ["plan", "architect", "none", "plan"]) {
		await shortcut.handler(pi.ctx);
		assert.deepEqual(pi.sentMessages.at(-1), [`/${mode === "none" ? "normal" : mode}`, { expandPromptTemplates: true }]);
		await pi.commands.get(mode === "none" ? "normal" : mode)!.handler("", pi.ctx);
		assert.equal(pi.tools().includes("write"), mode !== "plan");
		assert.equal(pi.thinking(), mode === "none" ? "medium" : "high");
		assert.equal(pi.entries.at(-1).data.mode, mode);
	}
});

test("arrow shortcuts follow a resumed workflow and do not switch during an active turn", async () => {
	const first = createTestPi();
	await first.commands.get("plan")!.handler("", first.ctx);
	const pi = createTestPi(first.entries);
	for (const key of ["ctrl+shift+right", "ctrl+shift+left"]) {
		await pi.shortcuts.get(key)!.handler({ ...pi.ctx, isIdle: () => false });
	}
	assert.deepEqual(pi.sentMessages, []);
	await pi.shortcuts.get("ctrl+shift+right")!.handler(pi.ctx);
	assert.deepEqual(pi.sentMessages, [["/architect", { expandPromptTemplates: true }]]);
	await pi.shortcuts.get("ctrl+shift+left")!.handler(pi.ctx);
	assert.deepEqual(pi.sentMessages.at(-1), ["/normal", { expandPromptTemplates: true }]);
});

test("ctrl+shift+left cycles in reverse and restores normal tools and thinking", async () => {
	const pi = createTestPi();
	assert.equal(pi.shortcuts.has("ctrl+shift+m"), false);
	const shortcut = pi.shortcuts.get("ctrl+shift+left")!;
	assert.ok(shortcut);
	for (const mode of ["architect", "plan", "none", "architect"]) {
		await shortcut.handler(pi.ctx);
		assert.deepEqual(pi.sentMessages.at(-1), [`/${mode === "none" ? "normal" : mode}`, { expandPromptTemplates: true }]);
		await pi.commands.get(mode === "none" ? "normal" : mode)!.handler("", pi.ctx);
		assert.equal(pi.tools().includes("write"), mode !== "plan");
		assert.equal(pi.thinking(), mode === "none" ? "medium" : "high");
		assert.equal(pi.entries.at(-1).data.mode, mode);
	}
});

test("default agent command is not registered", () => {
	const { commands } = createTestPi();
	assert.equal(commands.has("default"), false);
});

test("normal command replaces none while restoring legacy saved normal workflow", async () => {
	const pi = createTestPi([{ type: "custom", customType: "pi-parent-workflow", data: { mode: "none", tools: ["read", "write"], thinking: "max" } }], true);
	await pi.ready;
	assert.equal(pi.commands.has("normal"), true);
	assert.equal(pi.commands.has("none"), false);
	assert.deepEqual(pi.widgets.get("pi-parent-workflow")?.content, ["Workflow: normal"]);
	assert.equal(pi.thinking(), "medium");
	await pi.commands.get("plan")!.handler("", pi.ctx);
	await pi.commands.get("normal")!.handler("", pi.ctx);
	assert.deepEqual(pi.tools(), ["read", "write"]);
	assert.equal(pi.entries.at(-1).data.mode, "none");
});

test("review agent command is not registered", () => {
	const { commands } = createTestPi();
	assert.equal(commands.has("review"), false);
});

test("fresh sessions use normal workflow without changing tools", () => {
	const pi = createTestPi();
	assert.deepEqual(pi.tools(), pi.baseline);
	assert.equal(pi.thinking(), "medium");
	assert.match(pi.handlers.get("before_agent_start")!({ systemPrompt: "Base" }).systemPrompt, /Normal workflow/);
});

test("resume restores plan and its original baseline for /normal", async () => {
	const first = createTestPi();
	await first.commands.get("plan")!.handler("", first.ctx);
	const resumed = createTestPi(first.entries);
	assert.equal(resumed.tools().includes("write"), false);
	assert.equal(resumed.thinking(), "high");
	await resumed.commands.get("normal")!.handler("", resumed.ctx);
	assert.deepEqual(resumed.tools(), resumed.baseline);
	assert.equal(resumed.thinking(), "medium");
});

test("tree navigation restores the latest workflow on the selected branch", async () => {
	const pi = createTestPi();
	await pi.commands.get("architect")!.handler("", pi.ctx);
	await pi.commands.get("plan")!.handler("", pi.ctx);
	pi.entries.pop();
	pi.handlers.get("session_tree")!({}, pi.ctx);
	assert.deepEqual(pi.tools(), pi.baseline);
	assert.match(pi.handlers.get("before_agent_start")!({ systemPrompt: "Base" }).systemPrompt, /Complex \/ architect workflow/);
});

test("invalid saved state is ignored", () => {
	const pi = createTestPi([{ type: "custom", customType: "pi-parent-workflow", data: { mode: "plan", tools: null } }]);
	assert.equal(pi.thinking(), "medium");
});

test("returning to a branch without workflow state restores normal tools", async () => {
	const pi = createTestPi();
	await pi.commands.get("plan")!.handler("", pi.ctx);
	pi.entries.length = 0;
	pi.handlers.get("session_tree")!({}, pi.ctx);
	assert.deepEqual(pi.tools(), pi.baseline);
	assert.equal(pi.thinking(), "medium");
	assert.match(pi.handlers.get("before_agent_start")!({ systemPrompt: "Base" }).systemPrompt, /Normal workflow/);
});

test("background children do not inherit parent workflow commands or restrictions", () => {
	const saved = process.env.PI_SUBAGENT_CHILD;
	try {
		process.env.PI_SUBAGENT_CHILD = "1";
		const pi = createTestPi();
		assert.equal(pi.commands.size, 0);
		assert.equal(pi.handlers.size, 0);
		assert.equal(pi.registeredTools.size, 0);
	} finally {
		if (saved === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = saved;
	}
});
