import fs from 'fs';
import path from 'path';
import { loadEnv } from './config/env.js';
import { TaskStore } from './core/db/TaskStore.js';
import { MasterAgent } from './agents/MasterAgent.js';

loadEnv();

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
    const result = node.result_data ? (node.result_data.text || node.result_data.imagePath || JSON.stringify(node.result_data)) : 'N/A';
    console.log(`[${node.id}] Status: ${node.status}, Result: ${result.substring(0, 40)}...`);
  }
  console.log('--- Orchestration Complete ---');
}

main().catch(console.error);
