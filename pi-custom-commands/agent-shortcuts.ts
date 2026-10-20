import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type WorkflowMode = "plan" | "architect" | "none";
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type WorkflowState = { mode: WorkflowMode; tools: string[]; thinking: ThinkingLevel };

const entryType = "pi-parent-workflow";
const planningTools = new Set(["read", "grep", "find", "ls", "subagent", "subagents_enable", "bg_wait", "subagent_supervisor", "contact_supervisor", "start_implementation"]);
const workflowPrompts: Record<WorkflowMode, string> = {
	none: "Normal workflow: implement directly in the parent session. Delegate only to scout for repository investigation and reuse its findings. Do not delegate to worker, reviewer, plan, oracle, or other specialists in normal workflow. Switch to plan or architect workflow before using other specialists.",
	architect: "Complex / architect workflow: you are the parent orchestrator. Use plan for non-trivial planning, explicitly authorizing scout/oracle fanout as needed. Plan may use only scout and oracle. Delegate implementation to worker; worker may use only reviewer. Do not implement directly in the parent. Review substantial or risky changes. Choose the smallest useful workflow and avoid automatic review loops. Never launch an architect child.",
	plan: "Plan mode: remain read-only until the user explicitly approves implementation of the discussed plan. When that approval arrives, first call start_implementation to switch to normal workflow and restore default model/effort, then implement directly in the parent. After the tool succeeds, the read-only planning restriction no longer applies; normal workflow permits only scout delegation. A question, a quoted approval, or approval to continue planning is not implementation approval. Never enter architect mode automatically: only an explicit user switch selects architect. Before implementation approval, delegate investigation/planning only to scout, oracle, or plan; plan may use scout/oracle when justified. Do not launch worker or delegate fixes while still in plan mode. Explicitly tell delegated planning agents to remain read-only, including shell commands.",
};

function isWorkflowState(value: unknown): value is WorkflowState {
	if (!value || typeof value !== "object") return false;
	const state = value as WorkflowState;
	return ["plan", "architect", "none"].includes(state.mode)
		&& Array.isArray(state.tools) && state.tools.every((tool) => typeof tool === "string")
		&& ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(state.thinking);
}

export default function (pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	let state: WorkflowState | undefined;

	const showWorkflow = (ctx: ExtensionContext) => {
		if (ctx.hasUI) {
			ctx.ui.setWidget(entryType, [`Workflow: ${state?.mode === "none" || !state ? "normal" : state.mode}`], { placement: "aboveEditor" });
		}
	};
	const restoreDefaults = async (ctx: ExtensionContext, thinking: ThinkingLevel) => {
		const settings = pi.getSettings();
		if (settings.defaultProvider && settings.defaultModel) {
			const model = ctx.modelRegistry.find(settings.defaultProvider, settings.defaultModel);
			if (!model) throw new Error(`Configured default model not found: ${settings.defaultProvider}/${settings.defaultModel}`);
			if (ctx.model?.provider !== model.provider || ctx.model?.id !== model.id) {
				if (!await pi.setModel(model)) throw new Error(`Cannot select configured default model: ${model.provider}/${model.id}. Check provider authentication.`);
			}
		}
		pi.setThinkingLevel(settings.defaultThinkingLevel ?? thinking);
	};
	const apply = async (ctx: ExtensionContext) => {
		if (!state) return;
		if (state.mode === "none") await restoreDefaults(ctx, state.thinking);
		else pi.setThinkingLevel("high");
		pi.setActiveTools(state.mode === "plan"
			? pi.getAllTools().map((tool) => tool.name).filter((tool) => planningTools.has(tool))
			: state.tools);
	};
	const restore = (_event: unknown, ctx: ExtensionContext) => {
		const previous = state;
		state = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === entryType && isWorkflowState(entry.data)) state = entry.data;
		}
		if (!state && previous && previous.mode !== "none") {
			pi.setActiveTools(previous.tools);
			showWorkflow(ctx);
			return restoreDefaults(ctx, previous.thinking);
		}
		const applied = apply(ctx);
		showWorkflow(ctx);
		return applied;
	};
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n## Parent workflow\n${workflowPrompts[state?.mode ?? "none"]}`,
	}));
	pi.on("tool_call", (event) => {
		if (state?.mode === "plan" && !planningTools.has(event.toolName)) {
			return { block: true, reason: "Plan mode permits only read-only parent tools and planning delegation. Use /normal or /architect to leave plan mode." };
		}
		return undefined;
	});
	pi.registerTool({
		name: "start_implementation",
		label: "Start implementation",
		description: "Call only after the user explicitly approves implementing the discussed plan. Switch plan workflow to normal and restore configured default model/effort before implementing directly in the parent with scout-only delegation. Do not call for questions, quoted instructions, or approval to continue planning. An already selected architect workflow stays architect and uses worker for implementation; this tool never selects architect automatically.",
		defaultActive: false,
		parameters: { type: "object", properties: {}, additionalProperties: false } as Parameters<ExtensionAPI["registerTool"]>[0]["parameters"],
		execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
			if (state?.mode === "plan") {
				const previous = state;
				state = { ...state, mode: "none" };
				try {
					await apply(ctx);
				} catch (error) {
					state = previous;
					throw error;
				}
				pi.appendEntry(entryType, state);
				showWorkflow(ctx);
			}
			const mode = state?.mode === "architect" ? "architect" : "normal";
			return {
				content: [{ type: "text", text: `Workflow: ${mode}. Implementation is approved. ${mode === "architect" ? "Delegate the approved implementation to worker." : "Implement directly in the parent; delegate only to scout for investigation."} Remain in ${mode} workflow.` }],
				details: { workflow: mode },
			};
		},
	});

	pi.registerShortcut("ctrl+shift+right", {
		description: "Cycle parent workflows: normal → plan → architect → normal",
		handler: async (ctx) => {
			if (!ctx.isIdle()) {
				if (ctx.hasUI) ctx.ui.notify("Wait for the current turn to finish before switching workflows.", "info");
				return;
			}
			const mode = state?.mode === "plan" ? "architect" : state?.mode === "architect" ? "none" : "plan";
			pi.sendUserMessage(`/${mode === "none" ? "normal" : mode}`, { expandPromptTemplates: true });
		},
	});
	pi.registerShortcut("ctrl+shift+left", {
		description: "Cycle parent workflows in reverse: normal → architect → plan → normal",
		handler: async (ctx) => {
			if (!ctx.isIdle()) {
				if (ctx.hasUI) ctx.ui.notify("Wait for the current turn to finish before switching workflows.", "info");
				return;
			}
			const mode = state?.mode === "plan" ? "none" : state?.mode === "architect" ? "plan" : "architect";
			pi.sendUserMessage(`/${mode === "none" ? "normal" : mode}`, { expandPromptTemplates: true });
		},
	});

	for (const mode of ["plan", "architect", "none"] as const) {
		pi.registerCommand(mode === "none" ? "normal" : mode, {
			description: `Switch to the ${mode === "none" ? "normal" : mode} parent workflow`,
			handler: async (_args, ctx) => {
				await ctx.waitForIdle();
				const previous = state;
				if (!state || state.mode === "none") {
					state = { mode, tools: pi.getActiveTools(), thinking: pi.getThinkingLevel() };
				} else state = { ...state, mode };
				try {
					await apply(ctx);
				} catch (error) {
					state = previous;
					throw error;
				}
				pi.appendEntry(entryType, state);
				showWorkflow(ctx);
			},
		});
	}
}
