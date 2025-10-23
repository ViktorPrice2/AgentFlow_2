import { TaskStore } from '../core/db/TaskStore.js';
import { QueueService } from '../core/queue/QueueService.js';

// AGENT_MAP должен быть определен через top-level await в ESM
const AGENT_MAP = {
  WriterAgent: (await import('./WriterAgent.js')).WriterAgent,
  ImageAgent: (await import('./ImageAgent.js')).ImageAgent, // ImagePromptAgent
  VideoAgent: (await import('./VideoAgent.js')).VideoAgent, // VideoPromptAgent
  GuardAgent: (await import('./GuardAgent.js')).GuardAgent,
  RetryAgent: (await import('./RetryAgent.js')).RetryAgent,
  ProductAnalysisAgent: (await import('./ProductAnalysisAgent.js')).ProductAnalysisAgent,
  StrategyAgent: (await import('./StrategyAgent.js')).StrategyAgent,
};

async function processJob(job, onUpdate) {
  const { agentType, payload } = job;
  const { nodeId } = payload;

  const node = TaskStore.updateNodeStatus(nodeId, 'RUNNING');
  if (node && typeof onUpdate === 'function') {
    onUpdate(node.taskId);
  }

  const AgentModule = AGENT_MAP[agentType];
  if (!AgentModule) {
    TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Agent ${agentType} not found.` });
    if (typeof onUpdate === 'function') {
      onUpdate(node?.taskId || payload.taskId);
    }
    return null;
  }

  try {
    await AgentModule.execute(nodeId, payload);
  } catch (error) {
    console.error(`Worker error processing ${nodeId}:`, error.message);
  }

  const updatedNode = TaskStore.getNode(nodeId);
  if (updatedNode && typeof onUpdate === 'function') {
    onUpdate(updatedNode.taskId);
  }

  return updatedNode;
}

export class MasterAgent {
  static async runScheduler(taskId, onUpdate) {
    const task = TaskStore.getTask(taskId);
    if (!task) {
      return console.error('Task not found.');
    }

    if (task.status === 'CREATED') {
      task.status = 'RUNNING';
      if (typeof onUpdate === 'function') {
        onUpdate(taskId);
      }
    }

    let completed = false;
    while (!completed) {
      const readyNodes = TaskStore.getReadyNodes(taskId);

      for (const node of readyNodes) {
        console.log(`[Scheduler] Dispatching ${node.agent_type} for ${node.id}`);
        QueueService.addJob(node.agent_type, { taskId, nodeId: node.id, input_data: node.input_data });
      }

      while (!QueueService.isQueueEmpty()) {
        const job = QueueService.getJob();
        const processedNode = await processJob(job, onUpdate);

        if (processedNode && processedNode.status === 'FAILED' && processedNode.agent_type === 'GuardAgent') {
          const retryNode = TaskStore.createRetryAgentNode(taskId, processedNode.id);

          if (retryNode) {
            console.log(`[Scheduler] Guard FAIL on ${processedNode.id}. Launching ${retryNode.id}...`);
            QueueService.addJob('RetryAgent', { taskId, nodeId: retryNode.id, failedNodeId: processedNode.id });
            if (typeof onUpdate === 'function') {
              onUpdate(taskId);
            }
          }
        }
      }

      const updatedTask = TaskStore.getTask(taskId);
      if (updatedTask.status === 'COMPLETED' || updatedTask.status === 'FAILED') {
        completed = true;
        if (typeof onUpdate === 'function') {
          onUpdate(taskId);
        }
        break;
      }

      if (!completed && readyNodes.length === 0 && QueueService.isQueueEmpty()) {
        const allNodes = updatedTask.nodes.map(id => TaskStore.getNode(id));
        const plannedCount = allNodes.filter(n => n && n.status === 'PLANNED').length;

        if (plannedCount > 0) {
          console.warn('\n[Scheduler] Task Blocked. Transitioning to FAILED.');
          updatedTask.status = 'FAILED';
        }
        if (typeof onUpdate === 'function') {
          onUpdate(taskId);
        }
        completed = true;
      }
    }

    console.log(`\n[Scheduler] Final Task Status: ${TaskStore.getTask(taskId).status}`);
  }
}
