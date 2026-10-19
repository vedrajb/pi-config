import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import guardrails, { findSearchCommand, isGitCommit, isSkillRead, isSubagentProcess } from "./guardrails.ts";

const SKILL = "C:\\Users\\x\\.agents\\skills\\caveman-commit\\SKILL.md";
let saved: NodeJS.ProcessEnv;
beforeEach(() => {
	saved = { ...process.env };
	delete process.env.PI_SUBAGENT_CHILD;
	delete process.env.PI_GUARDRAILS_SEARCH;
	delete process.env.PI_CAVEMAN_COMMIT_SKILL;
});
afterEach(() => {
	for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
	Object.assign(process.env, saved);
});

function createTestPi() {
	const handlers = new Map<string, Function>();
	const commands = new Map<string, { handler: (a: string, c: any) => Promise<void> }>();
	const pi = {
		on(name: string, h: Function) {
			handlers.set(name, h);
		},
		registerCommand(name: string, c: any) {
			commands.set(name, c);
		},
	} as any;
	guardrails(pi);
	const call = (toolName: string, input: any) => handlers.get("tool_call")!({ toolName, input });
	return { handlers, commands, call };
}

describe("helpers", () => {
	test("isSubagentProcess", () => {
		assert.equal(isSubagentProcess({}), false);
		assert.equal(isSubagentProcess({ PI_SUBAGENT_CHILD: "0" }), false);
		assert.equal(isSubagentProcess({ PI_SUBAGENT_CHILD: "1" }), true);
		assert.equal(isSubagentProcess({ PI_SUBAGENT_CHILD: "false" }), false);
		assert.equal(isSubagentProcess({ PI_SUBAGENT_MAX_DEPTH: "2" }), false);
	});
	test("isGitCommit", () => {
		assert.equal(isGitCommit("git commit -m x"), true);
		assert.equal(isGitCommit("git -C repo commit -m x"), true);
		assert.equal(isGitCommit("cd a && git commit -m x"), true);
		assert.equal(isGitCommit("git -c a=b --no-pager commit"), true);
		assert.equal(isGitCommit("git log"), false);
		assert.equal(isGitCommit("git log --grep commit"), false);
		assert.equal(isGitCommit("echo commit"), false);
	});
	test("isSkillRead", () => {
		assert.equal(isSkillRead(SKILL), true);
		assert.equal(isSkillRead("/home/u/.agents/skills/caveman-commit/SKILL.md"), true);
		assert.equal(isSkillRead("/home/u/other/SKILL.md"), false);
	});
	test("findSearchCommand positives", () => {
		const cases: Array<[string, string]> = [
			["rg foo", "rg"],
			["cd x && rg foo", "rg"],
			["FOO=1 grep -r a .", "grep"],
			["find . -name a", "find"],
			["git grep x", "git grep"],
			["git ls-files", "git ls-files"],
			["Select-String -Path a x", "select-string"],
			["ls -R", "ls"],
			["Get-ChildItem -Recurse", "get-childitem"],
			["dir /s", "dir"],
			["rg foo | head", "rg"],
		];
		for (const [c, n] of cases) assert.equal(findSearchCommand(c), n, c);
	});
	test("findSearchCommand negatives", () => {
		for (const c of ["git status | grep x", "ls", "ls -la", "dir", "Get-ChildItem", "npm test", "git log", "echo hi"])
			assert.equal(findSearchCommand(c), undefined, c);
	});
});

describe("factory", () => {
	test("commit blocked before skill read, allowed after", () => {
		const { call } = createTestPi();
		assert.equal((call("bash", { command: "git commit -m x" }) as any).block, true);
		assert.equal(call("read", { path: SKILL }), undefined);
		assert.equal(call("bash", { command: "git commit -m x" }), undefined);
	});
	test("skill read via file_path and via shell cat", () => {
		const a = createTestPi();
		a.call("read", { file_path: SKILL });
		assert.equal(a.call("bash", { command: "git commit -m x" }), undefined);
		const b = createTestPi();
		b.call("bash", { command: "cat C:/u/.agents/skills/caveman-commit/SKILL.md" });
		assert.equal(b.call("powershell", { command: "git commit -m x" }), undefined);
	});
	test("custom skill path in reason", () => {
		process.env.PI_CAVEMAN_COMMIT_SKILL = "/custom/SKILL.md";
		const { call } = createTestPi();
		assert.match((call("bash", { command: "git commit" }) as any).reason, /\/custom\/SKILL\.md/);
	});
	test("session_start resets skillRead", () => {
		const { call, handlers } = createTestPi();
		call("read", { path: SKILL });
		handlers.get("session_start")!();
		assert.equal((call("bash", { command: "git commit -m x" }) as any).block, true);
	});
	test("search blocked in main", () => {
		const { call } = createTestPi();
		assert.equal((call("bash", { command: "cd x && rg foo" }) as any).block, true);
		assert.equal((call("Grep", { pattern: "a" }) as any).block, true);
		assert.equal(call("bash", { command: "git status | grep x" }), undefined);
		assert.equal(call("read", { path: "a.txt" }), undefined);
	});
	test("search allowed in subagent, commit gate still active", () => {
		process.env.PI_SUBAGENT_CHILD = "1";
		const { call } = createTestPi();
		assert.equal(call("bash", { command: "rg foo" }), undefined);
		assert.equal((call("bash", { command: "git commit -m x" }) as any).block, true);
	});
	test("/guardrails search off/on and status", async () => {
		const { call, commands } = createTestPi();
		const msgs: string[] = [];
		const ctx = { hasUI: true, ui: { notify: (m: string) => msgs.push(m) } };
		const cmd = commands.get("guardrails")!;
		await cmd.handler("search off", ctx);
		assert.equal(call("bash", { command: "rg foo" }), undefined);
		await cmd.handler("search on", ctx);
		assert.equal((call("bash", { command: "rg foo" }) as any).block, true);
		await cmd.handler("", ctx);
		assert.match(msgs.at(-1)!, /search gate on/);
		await cmd.handler("search off", { hasUI: false });
		assert.equal(call("bash", { command: "rg foo" }), undefined);
	});
	test("PI_GUARDRAILS_SEARCH=off disables gate", () => {
		process.env.PI_GUARDRAILS_SEARCH = "off";
		const { call } = createTestPi();
		assert.equal(call("bash", { command: "rg foo" }), undefined);
	});
});

test("bash cat of Windows-path SKILL.md counts as skill read", () => {
	const { call } = createTestPi();
	assert.equal(call("bash", { command: "git commit -m x" })?.block, true);
	call("bash", { command: `cat "${SKILL}"` });
	assert.equal(call("bash", { command: "git commit -m x" }), undefined);
});
