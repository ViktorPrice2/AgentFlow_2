# GuardAgent Forced Failure Analysis

## Observed Execution Trace
The execution log shows a repeating pattern:

1. `node1` (a `WriterAgent`) starts and finishes successfully, generating text.
2. `node2` (a `GuardAgent`) immediately fails with `FORCED_FAIL: Failure triggered by configuration.`
3. A `RetryAgent` node launches, generates a corrective prompt, and schedules a new writer/guard pair (`node1_v2`/`node2_v2`, then `node1_v3`/`node2_v3`).
4. Each new guard instance fails with the same `FORCED_FAIL` reason, causing the cycle to repeat.

## GuardAgent Failure Logic
The guard’s `execute` method checks the `FORCE_GUARD_FAIL` environment flag before running any real validation. When the flag is set to `"true"`, or to `"once"` before the first guard run, the agent short-circuits and marks the node as failed with the hard-coded reason from the log. 【F:agentflow_mvp/src/agents/GuardAgent.js†L235-L251】

Because the `forcedFailureConsumed` module flag is stored at the file level, a `FORCE_GUARD_FAIL` value of `"true"` forces *every* guard attempt to fail; a value of `"once"` forces exactly one failure across the entire process lifetime. In either case the guard never inspects the writer output, so the tone check never actually runs.

## Retry Loop Mechanics
`MasterAgent` watches for guard failures and enqueues a `RetryAgent` whenever it sees one. 【F:agentflow_mvp/src/agents/MasterAgent.js†L83-L99】 The retry node reads the failed guard’s `reason`, builds a corrective prompt, calls the model provider, and creates a new writer node plus a fresh guard that depends on it. 【F:agentflow_mvp/src/agents/RetryAgent.js†L42-L87】【F:agentflow_mvp/src/core/db/TaskStore.js†L115-L209】

Because the guard continues to fail for configuration reasons, each corrective iteration also fails, consuming another retry attempt. `TaskStore.createRetryAgentNode` caps the number of attempts using `MAX_RETRY_ATTEMPTS` (default `3`), so the system will eventually stop creating retries after the configured limit. 【F:agentflow_mvp/src/core/db/TaskStore.js†L130-L155】 Once the queue empties and unfinished planned nodes remain (e.g., the image-generation chain waiting on guard success), the scheduler marks the entire task as failed. 【F:agentflow_mvp/src/agents/MasterAgent.js†L103-L125】

## Root Cause and Resolution
The repeating `FORCED_FAIL` errors are not data-quality issues—they are an intentional safety valve controlled by the `FORCE_GUARD_FAIL` environment variable. To let the guard perform real validation, unset the flag or set it to `false` before running the workflow. If you only need a single forced failure for testing, set the flag to `once`; the first guard run will fail, but subsequent guard invocations in the same process will proceed normally because `forcedFailureConsumed` is then set to `true`.

## Secondary Effects
While the flag remains active, the system continues to spend tokens on the writer and retry agents even though progress is impossible. Consider disabling the flag after testing, or enhancing the retry logic to detect permanent configuration failures (e.g., by looking for the `FORCED_FAIL` reason and short-circuiting without invoking the LLM) to avoid unnecessary cost.
