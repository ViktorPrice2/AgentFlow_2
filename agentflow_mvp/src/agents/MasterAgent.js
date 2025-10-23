// src/agents/MasterAgent.js
// Файл input_file_0.js

import { TaskStore } from '../core/db/TaskStore.js';
import { QueueService } from '../core/queue/QueueService.js';

// AGENT_MAP должен быть определен через top-level await в ESM
const AGENT_MAP = {
  WriterAgent: (await import('./WriterAgent.js')).WriterAgent,
  ImageAgent: (await import('./ImageAgent.js')).ImageAgent,
  GuardAgent: (await import('./GuardAgent.js')).GuardAgent,
  RetryAgent: (await import('./RetryAgent.js')).RetryAgent, 
};

async function processJob(job, onUpdate) {
  const { agentType, payload } = job;
  const { nodeId } = payload;

  // 1. Установка статуса RUNNING
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
    // 2. Выполнение агента
    // Передаем payload (может содержать failedNodeId для RetryAgent)
    await AgentModule.execute(nodeId, payload); 
  } catch (error) {
    // Агент сам должен был установить FAILED в TaskStore
    console.error(`Worker error processing ${nodeId}:`, error.message);
  }

  const updatedNode = TaskStore.getNode(nodeId);
  if (updatedNode && typeof onUpdate === 'function') {
    onUpdate(updatedNode.taskId);
  }

  return updatedNode;
}

export class MasterAgent {
  // onUpdate - функция для WebSockets
  static async runScheduler(taskId, onUpdate) {
    const task = TaskStore.getTask(taskId);
    if (!task) {
      console.error('Task not found.');
      return;
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

      // 1. Диспетчеризация: Добавление готовых узлов в очередь
      for (const node of readyNodes) {
        console.log(`[Scheduler] Dispatching ${node.agent_type} for ${node.id}`);
        // В payload передается вся информация
        QueueService.addJob(node.agent_type, { taskId, nodeId: node.id, input_data: node.input_data });
      }

      // 2. Исполнение: Обработка всех текущих Job
      while (!QueueService.isQueueEmpty()) {
        const job = QueueService.getJob();
        const processedNode = await processJob(job, onUpdate);

        // 3. Логика Сбоя GuardAgent и Запуск RetryAgent
        if (processedNode && processedNode.status === 'FAILED' && processedNode.agent_type === 'GuardAgent') {
          const retryNode = TaskStore.createRetryAgentNode(taskId, processedNode.id);
          
          if (retryNode) {
            console.log(`[Scheduler] Guard FAIL on ${processedNode.id}. Launching ${retryNode.id}...`);
            // Добавляем RetryAgent в очередь для немедленного выполнения
            QueueService.addJob('RetryAgent', {
              taskId,
              nodeId: retryNode.id,
              failedNodeId: processedNode.id,
            });
            if (typeof onUpdate === 'function') {
              onUpdate(taskId);
            }
          }
          // Если retryNode === null, значит, достигнут максимум попыток, и TaskStore пометит задачу как FAILED
        }
      }
      
      // 4. Проверка завершения и выход
      const updatedTask = TaskStore.getTask(taskId);
      if (updatedTask.status === 'COMPLETED' || updatedTask.status === 'FAILED') {
        completed = true;
        if (typeof onUpdate === 'function') {
          onUpdate(taskId);
        }
        break;
      }

      // 5. Защита от зависаний: если нет готовых узлов и очередь пуста, но есть PLANNED
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