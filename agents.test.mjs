import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function agent(name) {
	return readFileSync(new URL(`./.pi.user/agents/${name}.md`, import.meta.url), "utf8");
}

test("specialists preserve model identities and use the intended thinking levels", () => {
	const models = {
		scout: "anthropic/claude-haiku-5-5",
		worker: "anthropic/claude-sonnet-5-5",
		reviewer: "anthropic/claude-opus-5-5",
	};
	for (const name of ["scout", "plan", "worker", "reviewer", "oracle"]) {
		const content = agent(name);
		assert.match(content, new RegExp(`^thinking: ${name === "scout" ? "low" : "high"}$`, "m"));
		assert.match(content, /^inheritProjectContext: true$/m);
		assert.match(content, /^inheritGlobalContext: false$/m);
		assert.doesNotMatch(content, /^(mode|maxDepth|permission):/m);
		if (models[name]) assert.ok(content.includes(`model: ${models[name]}`));
		else assert.doesNotMatch(content, /^model:/m);
	}
});

test("plan and worker permit exactly their intended nested specialists", () => {
	for (const [name, children] of [["plan", ["scout", "oracle"]], ["worker", ["reviewer"]]]) {
		const content = agent(name);
		assert.match(content, /^allowNestedSubagents: true$/m);
		assert.match(content, /^maxSubagentDepth: 2$/m);
		const allowed = content.match(/^allowedAgents:\r?\n((?:  - \w+\r?\n)+)/m)?.[1];
		assert.deepEqual(allowed?.trim().split(/\r?\n/).map((line) => line.trim().slice(2)), children);
	}
	assert.doesNotMatch(agent("worker"), /^tools:/m);
});

test("inspection leaves have no editing tools or nested delegation grant", () => {
	for (const name of ["scout", "reviewer", "oracle"]) {
		const content = agent(name);
		assert.match(content, /^maxSubagentDepth: 0$/m);
		assert.doesNotMatch(content, /^allowNestedSubagents: true$/m);
		const tools = content.match(/^tools: (.+)$/m)?.[1].split(/,\s*/);
		assert.ok(tools?.includes("read"));
		for (const tool of ["write", "edit", "subagent"]) assert.equal(tools.includes(tool), false);
	}
});

test("settings use one subagent framework and hide the legacy architect profile", () => {
	const settings = JSON.parse(readFileSync(new URL("./.pi.user/settings.json", import.meta.url), "utf8"));
	assert.ok(settings.packages.includes("npm:pi-subagents"));
	assert.equal(settings.packages.includes("npm:pi-open-agents"), false);
	assert.equal(settings.subagents.agentOverrides.architect.disabled, true);
	assert.equal(settings.defaultModel, "claude-opus-5-5");
});
