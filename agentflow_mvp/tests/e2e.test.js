import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { loadEnv } from '../src/config/env.js';
import { TaskStore } from '../src/core/db/TaskStore.js';
import { QueueService } from '../src/core/queue/QueueService.js';
import { MasterAgent } from '../src/agents/MasterAgent.js';

loadEnv('.env');

function createTestTask(dagPath) {
  const dagPlan = JSON.parse(fs.readFileSync(path.join(process.cwd(), dagPath), 'utf-8'));
  return TaskStore.createTask(dagPlan.task_name, dagPlan);
}

function findLastMatching(ids, predicate) {
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (predicate(ids[index])) {
      return ids[index];
    }
  }
  return undefined;
}

test.beforeEach(() => {
  TaskStore.reset();
  QueueService.clear();
  process.env.MOCK_MODE = 'true';
  process.env.FORCE_GUARD_FAIL = 'false';
});

test('E2E: Full DAG execution must complete successfully', async () => {
  const taskId = createTestTask('plans/dag.json');
  await MasterAgent.runScheduler(taskId);

  const task = TaskStore.getTask(taskId);
  assert.equal(task.status, 'COMPLETED');

  const writerNode = TaskStore.getNode('node1');
  const guard1Node = TaskStore.getNode('node2');
  const imageNode = TaskStore.getNode('node3');
  const guard2Node = TaskStore.getNode('node4');

  assert.equal(writerNode.status, 'SUCCESS');
  assert.ok(
    writerNode.result_data.text.includes(
      'MOCK: gemini-2.5-flash generated content for: Write an enthusiastic article about SuperProduct.'
    )
  );

  assert.equal(guard1Node.status, 'SUCCESS');
  assert.equal(guard1Node.result_data.status, 'SUCCESS');

  assert.equal(imageNode.status, 'SUCCESS');
  assert.ok(imageNode.result_data.imagePath.includes('.png'));

  assert.equal(guard2Node.status, 'SUCCESS');
});

test('E2E: GuardAgent failure triggers RetryAgent and recovers', async () => {
  process.env.FORCE_GUARD_FAIL = 'once';

  const taskId = createTestTask('plans/dag.json');
  await MasterAgent.runScheduler(taskId);

  const task = TaskStore.getTask(taskId);
  assert.equal(task.status, 'COMPLETED');

  const guard1Node = TaskStore.getNode('node2');
  assert.equal(guard1Node.status, 'SUCCESS');

  const retryWriterId = findLastMatching(task.nodes, id => id.startsWith('node1_v'));
  assert.ok(retryWriterId, 'Expected a corrective writer node to be created');
  const retryWriterNode = TaskStore.getNode(retryWriterId);
  assert.equal(retryWriterNode.status, 'SUCCESS');
  assert.ok(retryWriterNode.input_data.promptOverride, 'Corrective writer should have prompt override');

  assert.equal(guard1Node.dependsOn[0], retryWriterId);

  const retryAgentId = findLastMatching(task.nodes, id => id.startsWith('retry_node2'));
  assert.ok(retryAgentId, 'RetryAgent node should exist');
  const retryAgentNode = TaskStore.getNode(retryAgentId);
  assert.equal(retryAgentNode.status, 'SUCCESS');
});

test('E2E: Persistent GuardAgent failure marks task as failed', async () => {
  process.env.FORCE_GUARD_FAIL = 'true';

  const taskId = createTestTask('plans/dag.json');
  await MasterAgent.runScheduler(taskId);

  const task = TaskStore.getTask(taskId);
  assert.equal(task.status, 'FAILED');

  const guard1Node = TaskStore.getNode('node2');
  assert.equal(guard1Node.status, 'FAILED');

  const retryAgentId = findLastMatching(task.nodes, id => id.startsWith('retry_node2'));
  assert.ok(retryAgentId, 'RetryAgent should have been scheduled');
  const retryAgentNode = TaskStore.getNode(retryAgentId);
  assert.equal(retryAgentNode.status, 'FAILED');
});
