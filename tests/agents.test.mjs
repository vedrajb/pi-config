import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function agent(name) {
	return readFileSync(new URL(`../.pi.user/agents/${name}.md`, import.meta.url), "utf8");
}

test("specialists use the intended thinking levels and context settings", () => {
	for (const name of ["scout", "plan", "worker", "reviewer", "oracle"]) {
		const content = agent(name);
		assert.match(content, new RegExp(`^thinking: ${name === "scout" ? "low" : name === "worker" ? "medium" : "high"}$`, "m"));
		assert.match(content, /^inheritProjectContext: true$/m);
		assert.match(content, /^inheritGlobalContext: false$/m);
		assert.doesNotMatch(content, /^(mode|maxDepth|permission):/m);
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
