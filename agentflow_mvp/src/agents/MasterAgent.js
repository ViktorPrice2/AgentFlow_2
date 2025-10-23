import { TaskStore } from '../core/db/TaskStore.js';
import { QueueService } from '../core/queue/QueueService.js';

const AGENT_MAP = {
  WriterAgent: (await import('./WriterAgent.js')).WriterAgent,
  ImageAgent: (await import('./ImageAgent.js')).ImageAgent,
  GuardAgent: (await import('./GuardAgent.js')).GuardAgent,
  RetryAgent: (await import('./RetryAgent.js')).RetryAgent,
};

async function processJob(job) {
  const { agentType, payload } = job;
  const { nodeId } = payload;

  const node = TaskStore.updateNodeStatus(nodeId, 'RUNNING');

  const AgentModule = AGENT_MAP[agentType];
  if (!AgentModule) {
    TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Agent ${agentType} not found.` });
    return null;
  }

  try {
    await AgentModule.execute(nodeId, payload);
  } catch (error) {
    console.error(`Worker error processing ${nodeId}:`, error.message);
  }

  return TaskStore.getNode(nodeId);
}

export class MasterAgent {
  static async runScheduler(taskId) {
    const task = TaskStore.getTask(taskId);
    if (!task) {
      console.error('Task not found.');
      return;
    }

    if (task.status === 'CREATED') {
      task.status = 'RUNNING';
    }

    let completed = false;
    while (!completed) {
      const readyNodes = TaskStore.getReadyNodes(taskId);

      for (const node of readyNodes) {
        console.log(`[Scheduler] Dispatching ${node.agent_type} for ${node.id}`);
        QueueService.addJob(node.agent_type, { taskId, nodeId: node.id });
      }

      while (!QueueService.isQueueEmpty()) {
        const job = QueueService.getJob();
        const processedNode = await processJob(job);

        if (processedNode && processedNode.status === 'FAILED' && processedNode.agent_type === 'GuardAgent') {
          const retryNode = TaskStore.createRetryAgentNode(taskId, processedNode.id);
          if (retryNode) {
            console.log(`[Scheduler] Guard FAIL on ${processedNode.id}. Launching ${retryNode.id}...`);
            QueueService.addJob('RetryAgent', {
              taskId,
              nodeId: retryNode.id,
              failedNodeId: processedNode.id,
            });
          }
        }
      }

      const updatedTask = TaskStore.getTask(taskId);
      if (updatedTask.status === 'COMPLETED' || updatedTask.status === 'FAILED') {
        completed = true;
        break;
      }

      if (!completed && readyNodes.length === 0 && QueueService.isQueueEmpty()) {
        const allNodes = updatedTask.nodes.map(id => TaskStore.getNode(id));
        const plannedCount = allNodes.filter(n => n && n.status === 'PLANNED').length;
        const failedCount = allNodes.filter(n => n && n.status === 'FAILED').length;
        if (plannedCount > 0) {
          console.warn('\n[Scheduler] Task Blocked. Planned nodes remain, but no ready nodes. Check FAILED statuses.');
        }
        updatedTask.status = failedCount > 0 ? 'FAILED' : 'COMPLETED';
        completed = true;
      }
    }

    console.log(`\n[Scheduler] Final Task Status: ${TaskStore.getTask(taskId).status}`);
  }
}
