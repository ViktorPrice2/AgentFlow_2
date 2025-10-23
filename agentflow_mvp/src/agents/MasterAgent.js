// src/agents/MasterAgent.js

import { TaskStore } from '../core/db/TaskStore.js';
import { QueueService } from '../core/queue/QueueService.js';

// AGENT_MAP должен быть определен через top-level await в ESM
const AGENT_MAP = {
  WriterAgent: (await import('./WriterAgent.js')).WriterAgent,
  ImageAgent: (await import('./ImageAgent.js')).ImageAgent,
  GuardAgent: (await import('./GuardAgent.js')).GuardAgent,
  RetryAgent: (await import('./RetryAgent.js')).RetryAgent, // Убедитесь, что RetryAgent.js создан!
};

async function processJob(job) {
  const { agentType, payload } = job;
  const { nodeId } = payload;

  // 1. Установка статуса RUNNING
  const node = TaskStore.updateNodeStatus(nodeId, 'RUNNING');
  if (!node) return null;

  const AgentModule = AGENT_MAP[agentType];
  if (!AgentModule) {
    TaskStore.updateNodeStatus(nodeId, 'FAILED', { error: `Agent ${agentType} not found.` });
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

  // 3. Возврат обновленного узла
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

      // 1. Диспетчеризация: Добавление готовых узлов в очередь
      for (const node of readyNodes) {
        console.log(`[Scheduler] Dispatching ${node.agent_type} for ${node.id}`);
        QueueService.addJob(node.agent_type, { taskId, nodeId: node.id, input_data: node.input_data });
      }

      // 2. Исполнение: Обработка всех текущих Job
      while (!QueueService.isQueueEmpty()) {
        const job = QueueService.getJob();
        const processedNode = await processJob(job);

        // 3. Логика Сбоя GuardAgent и Запуск RetryAgent
        if (processedNode && processedNode.status === 'FAILED' && processedNode.agent_type === 'GuardAgent') {
          // Создание нового узла RetryAgent
          const retryNode = TaskStore.createRetryAgentNode(taskId, processedNode.id);
          
          if (retryNode) {
            console.log(`[Scheduler] Guard FAIL on ${processedNode.id}. Launching ${retryNode.id}...`);
            // Запуск RetryAgent (который теперь появится в очереди readyNodes на следующей итерации)
            // Мы просто переходим к следующей итерации цикла while (!completed), 
            // чтобы MasterAgent подобрал только что созданный RetryAgent.
          } else {
            // Если достигнут максимум попыток, TaskStore вернет null, и мы помечаем задачу как FAILED
            TaskStore.getTask(taskId).status = 'FAILED';
          }
        }
      }

      // 4. Проверка завершения
      const updatedTask = TaskStore.getTask(taskId);
      if (updatedTask.status === 'COMPLETED' || updatedTask.status === 'FAILED') {
        completed = true;
        break;
      }

      // 5. Защита от бесконечного цикла и зависаний
      if (readyNodes.length === 0 && QueueService.isQueueEmpty()) {
          const allNodes = updatedTask.nodes.map(id => TaskStore.getNode(id));
          const plannedCount = allNodes.filter(n => n && n.status === 'PLANNED').length;
          
          if (plannedCount > 0) {
              // Зависание: есть PLANNED, но нет READY (зависимость FAILED)
              console.warn('\n[Scheduler] Task Blocked. Transitioning to FAILED.');
              updatedTask.status = 'FAILED'; // Блокировка из-за неустранимой ошибки
          } 
          completed = true; // Выход из цикла
      }
    }

    console.log(`\n[Scheduler] Final Task Status: ${TaskStore.getTask(taskId).status}`);
  }
}