import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { registerReviewCommand } from "../../pi-custom-commands/review-command.ts";

function createTestPi(reply: any = { success: true, data: { details: { runId: "review-run" } } }) {
	const events = new EventEmitter();
	const commands = new Map<string, any>();
	const requests: any[] = [];
	const messages: any[] = [];
	let idle = false;
	events.on("subagents:rpc:v1:request", (request) => {
		assert.equal(idle, true);
		requests.push(request);
		if (reply instanceof Error) throw reply;
		if (reply !== null) events.emit(`subagents:rpc:v1:reply:${request.requestId}`, reply);
	});
	registerReviewCommand({
		registerCommand: (name: string, command: any) => commands.set(name, command),
		events: {
			on: (name: string, handler: (...args: any[]) => void) => {
				events.on(name, handler);
				return () => events.off(name, handler);
			},
			emit: (name: string, value: unknown) => events.emit(name, value),
		},
		sendMessage: (message: any) => messages.push(message),
	} as any);
	return { events, requests, messages, run: (args: string) => commands.get("review").handler(args, { waitForIdle: async () => { idle = true; } }) };
}

test("review launches exactly one reviewer via RPC, preserving literal instructions", async () => {
	const pi = createTestPi();
	const instructions = 'Review src/auth.ts\nFocus on "session" expiry; $(literal)';
	await pi.run(instructions);
	assert.equal(pi.requests.length, 1);
	assert.equal(pi.requests[0].method, "spawn");
	assert.equal(pi.requests[0].version, 1);
	assert.equal(pi.requests[0].params.agent, "reviewer");
	assert.match(pi.requests[0].params.task, /read-only/);
	assert.ok(pi.requests[0].params.task.endsWith(instructions));
	assert.deepEqual(Object.keys(pi.requests[0].params).sort(), ["agent", "task"]);
	assert.equal(pi.messages.length, 1);
	assert.deepEqual(pi.messages[0].details, { details: { runId: "review-run" } });
	assert.equal(pi.events.listenerCount(`subagents:rpc:v1:reply:${pi.requests[0].requestId}`), 0);
});

test("empty review instructions default to current uncommitted changes", async () => {
	const pi = createTestPi();
	await pi.run("  ");
	assert.match(pi.requests[0].params.task, /Review the current uncommitted changes/);
});

test("review launch errors never announce success and clean up listeners", async () => {
	for (const reply of [{ success: false, error: { message: "Reviewer unavailable" } }, {}, new Error("RPC unavailable")]) {
		const pi = createTestPi(reply);
		await assert.rejects(pi.run("Review diff"), /unavailable|Invalid pi-subagents response/);
		assert.deepEqual(pi.messages, []);
		assert.equal(pi.events.listenerCount(`subagents:rpc:v1:reply:${pi.requests[0].requestId}`), 0);
	}
});

test("missing RPC response reports uncertain launch without retrying", async () => {
	const pi = createTestPi(null);
	await assert.rejects(pi.run("Review diff"), /a review may have started/);
	assert.equal(pi.requests.length, 1);
	assert.deepEqual(pi.messages, []);
	assert.equal(pi.events.listenerCount(`subagents:rpc:v1:reply:${pi.requests[0].requestId}`), 0);
});
