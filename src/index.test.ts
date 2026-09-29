import assert from "node:assert/strict";
import test from "node:test";
import {
	extractAmazonBedrockEnvironment,
	readAmazonBedrockEnvironment,
} from "./index.ts";

test("extractAmazonBedrockEnvironment returns Bedrock AWS settings only", () => {
	assert.deepEqual(
		extractAmazonBedrockEnvironment({
			"amazon-bedrock": {
				env: {
					AWS_PROFILE: "default",
					AWS_REGION: "us-east-1",
					IGNORED: "value",
				},
			},
		}),
		{ AWS_PROFILE: "default", AWS_REGION: "us-east-1" },
	);
});

test("readAmazonBedrockEnvironment reads the Bedrock credential from Pi's auth file", () => {
	let requestedPath: string | undefined;
	const environment = readAmazonBedrockEnvironment(
		{ PI_CODING_AGENT_DIR: "/agent" },
		(path) => {
			requestedPath = path;
			return JSON.stringify({
				"amazon-bedrock": {
					env: { AWS_PROFILE: "default", AWS_DEFAULT_REGION: "us-east-1" },
				},
			});
		},
	);

	assert.match(requestedPath!, /agent[\\/]auth\.json$/);
	assert.deepEqual(environment, {
		AWS_PROFILE: "default",
		AWS_DEFAULT_REGION: "us-east-1",
	});
});
test("extractAmazonBedrockEnvironment ignores malformed credentials and empty values", () => {
	assert.deepEqual(extractAmazonBedrockEnvironment(undefined), {});
	assert.deepEqual(extractAmazonBedrockEnvironment({ "amazon-bedrock": { env: null } }), {});
	assert.deepEqual(
		extractAmazonBedrockEnvironment({
			"amazon-bedrock": { env: { AWS_PROFILE: " ", AWS_REGION: 12 } },
		}),
		{},
	);
});
