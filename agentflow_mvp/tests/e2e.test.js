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

    const writerNode = TaskStore.getNode('node1_write');
    const guardNode = TaskStore.getNode('node2_guard');
    const analysisNode = TaskStore.getNode('node1_analyze');
    const strategyNode = TaskStore.getNode('node2_strategy');
    const imageNode = TaskStore.getNode('node3_image_prompt');
    const videoNode = TaskStore.getNode('node4_video_prompt');
    const reviewNode = TaskStore.getNode('node5_review_strategy');

    expect(writerNode.status).toBe('SUCCESS');
    expect(writerNode.result_data.text).toContain('MOCK: gemini-2.5-flash generated content for:');
    expect(writerNode.result_data.text).toContain('Напиши статью');

    expect(guardNode.status).toBe('SUCCESS');
    expect(guardNode.result_data.status).toBe('SUCCESS');

    expect(analysisNode.status).toBe('SUCCESS');
    expect(Array.isArray(analysisNode.result_data.kqm)).toBe(true);

    expect(strategyNode.status).toBe('SUCCESS');
    expect(Array.isArray(strategyNode.result_data.schedule)).toBe(true);

    expect(imageNode.status).toBe('SUCCESS');
    expect(imageNode.result_data.imagePath).toContain('.png');
    const resolvedImagePath = path.join(process.cwd(), imageNode.result_data.imagePath);
    expect(fs.existsSync(resolvedImagePath)).toBe(true);

    expect(videoNode.status).toBe('SUCCESS');

    expect(reviewNode.status).toBe('SUCCESS');
    expect(Array.isArray(reviewNode.result_data.extension_schedule)).toBe(true);

    const taskSchedule = TaskStore.getTaskSchedule(taskId);
    expect(taskSchedule.length).toBe(
      (strategyNode.result_data.schedule?.length || 0) + (reviewNode.result_data.extension_schedule?.length || 0)
    );
  });

  test('guard failure triggers retry agent and recovers', async () => {
    process.env.FORCE_GUARD_FAIL = 'once';

    const taskId = createTestTask('plans/dag.json');
    await MasterAgent.runScheduler(taskId);

    const task = TaskStore.getTask(taskId);
    expect(task.status).toBe('COMPLETED');

    const guardNode = TaskStore.getNode('node2_guard');
    expect(guardNode.status).toBe('SKIPPED_RETRY');

    const retryWriterId = findLastMatching(task.nodes, id => id.startsWith('node1_write_v'));
    expect(retryWriterId).toBeDefined();
    const retryWriterNode = TaskStore.getNode(retryWriterId);
    expect(retryWriterNode.status).toBe('SUCCESS');
    expect(retryWriterNode.input_data.promptOverride).toBeTruthy();

    const retryGuardId = findLastMatching(task.nodes, id => id.startsWith('node2_guard_v'));
    expect(retryGuardId).toBeDefined();
    const retryGuardNode = TaskStore.getNode(retryGuardId);
    expect(retryGuardNode.status).toBe('SUCCESS');
    expect(retryGuardNode.dependsOn[0]).toBe(retryWriterId);
    expect(guardNode.result_data?.nextGuard).toBe(retryGuardId);

    const retryAgentId = findLastMatching(task.nodes, id => id.startsWith('retry_node2_guard'));
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

    const guardNode = TaskStore.getNode('node2_guard');
    expect(guardNode.status).toBe('SKIPPED_RETRY');

    const lastGuardId = findLastMatching(task.nodes, id => id.startsWith('node2_guard_v'));
    expect(lastGuardId).toBeDefined();
    const lastGuardNode = TaskStore.getNode(lastGuardId);
    expect(lastGuardNode.status).toBe('FAILED');

    const retryAgentId = findLastMatching(task.nodes, id => id.startsWith('retry_node2_guard'));
    expect(retryAgentId).toBeDefined();
    const retryAgentNode = TaskStore.getNode(retryAgentId);
    expect(retryAgentNode.status).toBe('SUCCESS');
  });
});
