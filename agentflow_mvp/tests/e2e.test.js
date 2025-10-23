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
  assert.ok(writerNode.result_data.text.includes('MOCK: gpt-4 generated content for: Write an enthusiastic article about SuperProduct.'));

  assert.equal(guard1Node.status, 'SUCCESS');
  assert.equal(guard1Node.result_data.status, 'SUCCESS');

  assert.equal(imageNode.status, 'SUCCESS');
  assert.ok(imageNode.result_data.imagePath.includes('.png'));

  assert.equal(guard2Node.status, 'SUCCESS');
});

test('E2E: GuardAgent failure must block subsequent nodes', async () => {
  process.env.FORCE_GUARD_FAIL = 'true';

  const taskId = createTestTask('plans/dag.json');
  await MasterAgent.runScheduler(taskId);

  const task = TaskStore.getTask(taskId);

  const guard1Node = TaskStore.getNode('node2');
  assert.equal(guard1Node.status, 'FAILED');
  assert.equal(guard1Node.result_data.reason, 'TONE_MISMATCH: Content was too formal.');

  const imageNode = TaskStore.getNode('node3');
  assert.equal(imageNode.status, 'PLANNED');

  assert.equal(task.status, 'COMPLETED');
});
