import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { TaskStore } from './core/db/TaskStore.js';
import { MasterAgent } from './agents/MasterAgent.js';

const DAG_PATH = path.join('plans', 'dag.json');

async function main() {
  console.log('--- AgentFlow 2.0 MVP Orchestration Start ---');

  if (!fs.existsSync(DAG_PATH)) {
    console.error(`Error: DAG file not found at ${DAG_PATH}`);
    return;
  }

  const dagPlan = JSON.parse(fs.readFileSync(DAG_PATH, 'utf-8'));

  const taskId = TaskStore.createTask(dagPlan.task_name, dagPlan);
  console.log(`Task Created: ${taskId}. Nodes: ${dagPlan.nodes.length}`);

  await MasterAgent.runScheduler(taskId);

  const finalTask = TaskStore.getTask(taskId);
  console.log(`\n--- Final Audit for ${taskId} ---`);
  for (const nodeId of finalTask.nodes) {
    const node = TaskStore.getNode(nodeId);
    if (!node) continue;

    const baseResult = node.result_data
      ? node.result_data.text || node.result_data.imagePath || JSON.stringify(node.result_data)
      : 'N/A';

    if (node.status === 'FAILED') {
      const reason = node.result_data?.reason || node.result_data?.error || 'Unknown Error';
      console.log(`[${node.id}] Status: FAILED, Reason: ${reason}`);
      continue;
    }

    const retryInfo = node.retryOf ? ` (retry of ${node.retryOf})` : '';
    console.log(`[${node.id}] Status: ${node.status}${retryInfo}, Result: ${baseResult.substring(0, 80)}...`);
  }
  console.log('--- Orchestration Complete ---');
}

main().catch(console.error);
