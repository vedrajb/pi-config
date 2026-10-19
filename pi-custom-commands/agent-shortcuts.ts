import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type WorkflowMode = "plan" | "architect" | "none";
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type WorkflowState = { mode: WorkflowMode; tools: string[]; thinking: ThinkingLevel };

const entryType = "pi-parent-workflow";
const planningTools = new Set(["read", "grep", "find", "ls", "subagent", "subagents_enable", "bg_wait", "subagent_supervisor", "contact_supervisor"]);
const workflowPrompts: Record<WorkflowMode, string> = {
	none: "Normal workflow: implement in the parent session. Use only scout subagents for investigation unless the user explicitly requests another specialist or the complex workflow. Delegate repository searches to scouts and reuse their findings.",
	architect: "Complex / architect workflow: you are the parent orchestrator. Use plan for non-trivial planning, explicitly authorizing scout/oracle fanout as needed. Plan may use only scout and oracle. Implement directly or delegate bounded work to worker; worker may use only reviewer. Review substantial or risky changes. Choose the smallest useful workflow and avoid automatic review loops. Never launch an architect child.",
	plan: "Plan mode: remain read-only. Produce an implementation-ready plan; do not implement or modify files. Delegate investigation/planning only to scout, oracle, or plan. Plan may use scout/oracle when justified. Do not launch worker or delegate fixes. Explicitly tell delegated agents to remain read-only, including shell commands.",
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

	const apply = () => {
		if (!state) return;
		pi.setActiveTools(state.mode === "plan"
			? pi.getAllTools().map((tool) => tool.name).filter((tool) => planningTools.has(tool))
			: state.tools);
		pi.setThinkingLevel(state.mode === "none" ? state.thinking : "high");
	};
	const restore = (_event: unknown, ctx: ExtensionContext) => {
		const previous = state;
		state = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === entryType && isWorkflowState(entry.data)) state = entry.data;
		}
		if (!state && previous && previous.mode !== "none") {
			pi.setActiveTools(previous.tools);
			pi.setThinkingLevel(previous.thinking);
		}
		apply();
	};
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n## Parent workflow\n${workflowPrompts[state?.mode ?? "none"]}`,
	}));
	pi.on("tool_call", (event) => {
		if (state?.mode === "plan" && !planningTools.has(event.toolName)) {
			return { block: true, reason: "Plan mode permits only read-only parent tools and planning delegation. Use /none or /architect to leave plan mode." };
		}
		return undefined;
	});

	pi.registerShortcut("ctrl+shift+right", {
		description: "Cycle parent workflows: normal → plan → architect → normal",
		handler: async (ctx) => {
			if (!ctx.isIdle()) {
				if (ctx.hasUI) ctx.ui.notify("Wait for the current turn to finish before switching workflows.", "info");
				return;
			}
			const mode = state?.mode === "plan" ? "architect" : state?.mode === "architect" ? "none" : "plan";
			pi.sendUserMessage(`/${mode}`, { expandPromptTemplates: true });
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
			pi.sendUserMessage(`/${mode}`, { expandPromptTemplates: true });
		},
	});

	for (const mode of ["plan", "architect", "none"] as const) {
		pi.registerCommand(mode, {
			description: `Switch to the ${mode === "none" ? "normal" : mode} parent workflow`,
			handler: async (_args, ctx) => {
				await ctx.waitForIdle();
				if (!state || state.mode === "none") {
					state = { mode, tools: pi.getActiveTools(), thinking: pi.getThinkingLevel() };
				} else state = { ...state, mode };
				apply();
				pi.appendEntry(entryType, state);
				if (ctx.hasUI) ctx.ui.notify(`Parent workflow: ${mode === "none" ? "normal" : mode}`, "info");
			},
		});
	}
}
