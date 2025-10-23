import { beforeEach, describe, expect, test } from 'vitest';
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

describe('AgentFlow end-to-end scheduler', () => {
  beforeEach(() => {
    TaskStore.reset();
    QueueService.clear();
    process.env.MOCK_MODE = 'true';
    process.env.FORCE_GUARD_FAIL = 'false';
  });

  test('completes the full DAG successfully', async () => {
    const taskId = createTestTask('plans/dag.json');
    await MasterAgent.runScheduler(taskId);

    const task = TaskStore.getTask(taskId);
    expect(task.status).toBe('COMPLETED');

    const writerNode = TaskStore.getNode('node1');
    const guard1Node = TaskStore.getNode('node2');
    const imageNode = TaskStore.getNode('node3');
    const guard2Node = TaskStore.getNode('node4');

    expect(writerNode.status).toBe('SUCCESS');
    expect(writerNode.result_data.text).toContain('MOCK: gemini-2.5-flash generated content for:');
    expect(writerNode.result_data.text).toContain('Напиши статью');

    expect(guard1Node.status).toBe('SUCCESS');
    expect(guard1Node.result_data.status).toBe('SUCCESS');

    expect(imageNode.status).toBe('SUCCESS');
    expect(imageNode.result_data.imagePath).toContain('.png');
    const resolvedImagePath = path.join(process.cwd(), imageNode.result_data.imagePath);
    expect(fs.existsSync(resolvedImagePath)).toBe(true);

    expect(guard2Node.status).toBe('SUCCESS');
  });

  test('guard failure triggers retry agent and recovers', async () => {
    process.env.FORCE_GUARD_FAIL = 'once';

    const taskId = createTestTask('plans/dag.json');
    await MasterAgent.runScheduler(taskId);

    const task = TaskStore.getTask(taskId);
    expect(task.status).toBe('COMPLETED');

    const guard1Node = TaskStore.getNode('node2');
    expect(guard1Node.status).toBe('SKIPPED_RETRY');

    const retryWriterId = findLastMatching(task.nodes, id => id.startsWith('node1_v'));
    expect(retryWriterId).toBeDefined();
    const retryWriterNode = TaskStore.getNode(retryWriterId);
    expect(retryWriterNode.status).toBe('SUCCESS');
    expect(retryWriterNode.input_data.promptOverride).toBeTruthy();

    const retryGuardId = findLastMatching(task.nodes, id => id.startsWith('node2_v'));
    expect(retryGuardId).toBeDefined();
    const retryGuardNode = TaskStore.getNode(retryGuardId);
    expect(retryGuardNode.status).toBe('SUCCESS');
    expect(retryGuardNode.dependsOn[0]).toBe(retryWriterId);
    expect(guard1Node.result_data?.nextGuard).toBe(retryGuardId);

    const retryAgentId = findLastMatching(task.nodes, id => id.startsWith('retry_node2'));
    expect(retryAgentId).toBeDefined();
    const retryAgentNode = TaskStore.getNode(retryAgentId);
    expect(retryAgentNode.status).toBe('SUCCESS');
  });

  test('persistent guard failure marks task as failed', async () => {
    process.env.FORCE_GUARD_FAIL = 'true';

    const taskId = createTestTask('plans/dag.json');
    await MasterAgent.runScheduler(taskId);

    const task = TaskStore.getTask(taskId);
    expect(task.status).toBe('FAILED');

    const guard1Node = TaskStore.getNode('node2');
    expect(guard1Node.status).toBe('SKIPPED_RETRY');

    const lastGuardId = findLastMatching(task.nodes, id => id.startsWith('node2_v'));
    expect(lastGuardId).toBeDefined();
    const lastGuardNode = TaskStore.getNode(lastGuardId);
    expect(lastGuardNode.status).toBe('FAILED');

    const retryAgentId = findLastMatching(task.nodes, id => id.startsWith('retry_node2'));
    expect(retryAgentId).toBeDefined();
    const retryAgentNode = TaskStore.getNode(retryAgentId);
    expect(retryAgentNode.status).toBe('SUCCESS');
  });
});
