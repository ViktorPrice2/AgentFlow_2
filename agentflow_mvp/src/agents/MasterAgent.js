import { TaskStore } from '../core/db/TaskStore.js';
import { QueueService } from '../core/queue/QueueService.js';

let agentModuleCache = null;

const loadAgentModule = async agentType => {
  if (!agentModuleCache) {
    agentModuleCache = {
      WriterAgent: (await import('./WriterAgent.js')).WriterAgent,
      ImageAgent: (await import('./ImageAgent.js')).ImageAgent, // ImagePromptAgent
      VideoAgent: (await import('./VideoAgent.js')).VideoAgent, // VideoPromptAgent
      GuardAgent: (await import('./GuardAgent.js')).GuardAgent,
      RetryAgent: (await import('./RetryAgent.js')).RetryAgent,
      HumanGateAgent: (await import('./HumanGateAgent.js')).HumanGateAgent,
      ProductAnalysisAgent: (await import('./ProductAnalysisAgent.js')).ProductAnalysisAgent,
      StrategyAgent: (await import('./StrategyAgent.js')).StrategyAgent,
      StrategyReviewAgent: (await import('./StrategyReviewAgent.js')).StrategyReviewAgent,
    };
  }

  return agentModuleCache[agentType] || null;
};

const FINAL_NODE_STATUSES = new Set(['SUCCESS', 'FAILED', 'MANUALLY_OVERRIDDEN', 'SKIPPED_RETRY']);

async function processJob(job, onUpdate) {
  if (!job) {
    console.error('[MasterAgent] Attempted to process an empty job from the queue.');
    return null;
  }

  const { agentType, payload } = job;
  const nodeId = payload?.nodeId;

  if (!nodeId) {
    console.error(`[MasterAgent] Job for agent ${agentType} is missing a nodeId.`);
    return null;
  }

  const existingNode = TaskStore.getNode(nodeId);
  if (!existingNode) {
    console.error(`[MasterAgent] Node ${nodeId} not found for agent ${agentType}.`);
    TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: 'Node not found for job.' });
    return null;
  }

  const node = TaskStore.updateNodeStatus(nodeId, 'RUNNING');
  if (node && typeof onUpdate === 'function') {
    onUpdate(node.taskId);
  }

  const AgentModule = await loadAgentModule(agentType);
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
    console.error(`Worker error processing ${nodeId}:`, error);
    TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: error.message || String(error) });
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
      await new Promise(resolve => setTimeout(resolve, 50)); // Освобождаем Event Loop
      const readyNodes = TaskStore.getReadyNodes(taskId).filter(node => node.status !== 'PAUSED');

      for (const node of readyNodes) {
        console.log(`[Scheduler] Dispatching ${node.agent_type} for ${node.id}`);
        QueueService.addJob(node.agent_type, { taskId, nodeId: node.id, input_data: node.input_data });

        if (node.agent_type === 'HumanGateAgent') {
          const job = QueueService.getJob();
          await processJob(job, onUpdate);
        }
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
      if (!updatedTask) {
        console.error(`[MasterAgent] Task ${taskId} no longer exists in TaskStore during scheduling loop.`);
        completed = true;
        break;
      }
      if (updatedTask.status === 'COMPLETED' || updatedTask.status === 'FAILED') {
        completed = true;
        if (typeof onUpdate === 'function') {
          onUpdate(taskId);
        }
        break;
      }

      if (!completed && readyNodes.length === 0 && QueueService.isQueueEmpty()) {
        const allNodes = updatedTask.nodes.map(id => TaskStore.getNode(id));
        const pausedCount = allNodes.filter(n => n?.status === 'PAUSED').length;
        const plannedCount = allNodes.filter(n => n && (n.status === 'PLANNED' || n.status === 'PAUSED')).length;

        if (pausedCount > 0) {
          console.warn('\n[Scheduler] Task Paused/Blocked. Waiting for Human Input or Retry Limit.');
          updatedTask.status = 'PAUSED';
          TaskStore.saveToDisk();
          if (typeof onUpdate === 'function') {
            onUpdate(taskId);
          }
          break;
        }

        if (plannedCount > 0) {
          console.warn('\n[Scheduler] Task Blocked. Transitioning to FAILED.');
          updatedTask.status = 'FAILED';
          TaskStore.saveToDisk();
        }
        if (typeof onUpdate === 'function') {
          onUpdate(taskId);
        }
        completed = true;
      }
    }

    console.log(`\n[Scheduler] Final Task Status: ${TaskStore.getTask(taskId).status}`);
  }

  static async resumeTasks(onUpdate) {
    const tasksMap = TaskStore.getAllTasks();
    if (!(tasksMap instanceof Map) || tasksMap.size === 0) {
      return;
    }

    const tasksToResume = [];
    const tasksToNotify = new Set();
    let storeDirty = false;

    for (const [taskId, task] of tasksMap.entries()) {
      if (!task) {
        continue;
      }

      const nodeEntries = Array.isArray(task.nodes)
        ? task.nodes.map(id => TaskStore.getNode(id)).filter(Boolean)
        : [];

      if (nodeEntries.length === 0) {
        continue;
      }

      const allCompleted = nodeEntries.every(node => FINAL_NODE_STATUSES.has(node.status));
      if (allCompleted) {
        const anyFailed = nodeEntries.some(node => node.status === 'FAILED');
        const finalStatus = anyFailed ? 'FAILED' : 'COMPLETED';
        if (task.status !== finalStatus) {
          task.status = finalStatus;
          storeDirty = true;
          tasksToNotify.add(taskId);
        }
        continue;
      }

      const hasPendingOrRunning = nodeEntries.some(
        node => node.status === 'PLANNED' || node.status === 'RUNNING'
      );

      if (!hasPendingOrRunning) {
        continue;
      }

      const shouldResume =
        task.status === 'RUNNING' ||
        task.status === 'CREATED' ||
        (task.status === 'FAILED' && nodeEntries.some(node => node.status === 'RUNNING'));

      if (!shouldResume) {
        continue;
      }

      let mutated = false;
      for (const node of nodeEntries) {
        if (node.status === 'RUNNING') {
          node.status = 'PLANNED';
          node.result_data = null;
          mutated = true;
        }
      }

      if (task.status !== 'RUNNING') {
        task.status = 'RUNNING';
        mutated = true;
      }

      if (mutated) {
        storeDirty = true;
        tasksToNotify.add(taskId);
      }

      tasksToResume.push(taskId);
    }

    if (storeDirty) {
      TaskStore.saveToDisk();
    }

    if (typeof onUpdate === 'function') {
      tasksToNotify.forEach(taskId => onUpdate(taskId));
    }

    if (tasksToResume.length > 0) {
      console.log(`[MasterAgent] Resuming ${tasksToResume.length} task(s) after restart.`);
    }

    for (const taskId of tasksToResume) {
      MasterAgent.runScheduler(taskId, onUpdate).catch(error => {
        console.error(`[MasterAgent] Failed to resume task ${taskId}:`, error);
      });
    }
  }
}
