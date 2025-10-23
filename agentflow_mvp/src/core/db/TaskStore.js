// src/core/db/TaskStore.js

const tasks = new Map();
const nodes = new Map(); // nodes и tasks должны быть доступны через TaskStore.get...
let taskIdCounter = 1;

// Вспомогательная функция для клонирования объекта
function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

export class TaskStore {
  static createTask(name, dagPlan) {
    const taskId = `task_${taskIdCounter++}`;
    tasks.set(taskId, { name, dagPlan, status: 'CREATED', nodes: [] });

    let nodeIdCounter = 1;
    for (const nodeDef of dagPlan.nodes) {
      const nodeId = `${nodeDef.id}`;
      nodes.set(nodeId, {
        id: nodeId,
        taskId,
        agent_type: nodeDef.agent,
        status: 'PLANNED',
        input_data: clone(nodeDef.input),
        dependsOn: nodeDef.dependsOn || [],
        result_data: null,
        cost: 0,
        attempt: 1, // Счетчик попыток
      });
      tasks.get(taskId).nodes.push(nodeId);
      nodeIdCounter++;
    }
    return taskId;
  }

  static getNode(nodeId) {
    return nodes.get(nodeId);
  }

  static getTask(taskId) {
    return tasks.get(taskId);
  }

  static getReadyNodes(taskId) {
    const task = tasks.get(taskId);
    if (!task || (task.status !== 'RUNNING' && task.status !== 'CREATED')) return [];

    const readyNodes = [];
    for (const nodeId of task.nodes) {
      const node = nodes.get(nodeId);
      if (!node || node.status !== 'PLANNED') continue;

      const allDepsMet = node.dependsOn.every(depId => {
        const depNode = nodes.get(depId);
        return depNode && depNode.status === 'SUCCESS';
      });

      if (allDepsMet) {
        readyNodes.push(node);
      }
    }
    return readyNodes;
  }

  static updateNodeStatus(nodeId, status, resultData = null, cost = 0) {
    const node = nodes.get(nodeId);
    if (node) {
      node.status = status;
      if (resultData) {
        node.result_data = { ...node.result_data, ...resultData };
      }
      node.cost += cost;

      const task = tasks.get(node.taskId);
      if (task) {
        if (status === 'RUNNING') {
          task.status = 'RUNNING';
        }

        const allCompleted = task.nodes.every(id => {
          const n = nodes.get(id);
          return n && (n.status === 'SUCCESS' || n.status === 'FAILED' || n.status === 'MANUALLY_OVERRIDDEN');
        });

        if (allCompleted && task.status !== 'FAILED') {
          const anyFailed = task.nodes.some(id => nodes.get(id)?.status === 'FAILED');
          task.status = anyFailed ? 'FAILED' : 'COMPLETED';
        }
      }

      return node;
    }
    return null;
  }

  static getResult(nodeId) {
    const node = nodes.get(nodeId);
    return node ? node.result_data : null;
  }

  // --- ЛОГИКА САМОКОРРЕКЦИИ ---

  /**
   * Создает узел RetryAgent.
   */
  static createRetryAgentNode(taskId, failedGuardNodeId) {
    const failedNode = nodes.get(failedGuardNodeId);
    if (!failedNode || failedNode.is_retry) return null;

    const originalNodeId = failedNode.dependsOn[0];
    const originalNode = nodes.get(originalNodeId);
    if (!originalNode) return null;

    // Считаем все узлы, связанные с оригинальной генерацией (WriterAgent, ImageAgent)
    const allAttempts = Array.from(nodes.values()).filter(n =>
      n.agent_type === originalNode.agent_type && 
      n.input_data.topic === originalNode.input_data.topic && 
      n.id.startsWith(originalNodeId)
    );

    const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || 3, 10);
    const currentAttempt = allAttempts.length;

    if (currentAttempt >= MAX_RETRY_ATTEMPTS) {
      console.warn(`[TaskStore] Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached for ${originalNodeId}.`);
      return null;
    }

    const retryNodeId = `retry_${failedGuardNodeId}_v${currentAttempt}`;

    const newNode = {
      id: retryNodeId,
      taskId,
      agent_type: 'RetryAgent',
      status: 'PLANNED',
      input_data: { failedNodeId: failedGuardNodeId, originalNodeId: originalNodeId },
      dependsOn: [failedGuardNodeId],
      result_data: null,
      cost: 0,
      attempt: currentAttempt + 1,
      is_retry: true,
    };

    nodes.set(retryNodeId, newNode);
    tasks.get(taskId).nodes.push(retryNodeId);
    return newNode;
  }

  /**
   * Создает НОВЫЙ генеративный узел (например, WriterAgent) после RetryAgent.
   */
  static createCorrectiveNode(originalNodeId, updatedInputData) {
    const originalNode = nodes.get(originalNodeId);
    if (!originalNode) return null;
    
    const taskId = originalNode.taskId;
    const newAgentId = `${originalNodeId}_v${(originalNode.attempt || 1) + 1}`;
    
    // Создаем новый GuardAgent, который будет проверять новый генеративный узел
    const originalGuard = Array.from(nodes.values()).find(n => n.dependsOn.includes(originalNodeId) && n.agent_type === 'GuardAgent');

    const newNode = {
        id: newAgentId,
        taskId,
        agent_type: originalNode.agent_type,
        status: 'PLANNED',
        input_data: updatedInputData,
        dependsOn: originalNode.dependsOn, // Зависит от тех же узлов, что и оригинал (кроме GuardAgent)
        result_data: null,
        cost: 0,
        attempt: originalNode.attempt + 1,
        is_retry: false,
    };
    nodes.set(newAgentId, newNode);
    tasks.get(taskId).nodes.push(newAgentId);

    // Обновляем GuardAgent (чтобы он зависел от нового узла)
    if (originalGuard) {
        // Узел GuardAgent будет пересоздан для проверки нового генеративного узла. 
        // В упрощенном MVP мы просто обновляем зависимости оригинального GuardAgent.
        const originalGuardId = originalGuard.id;
        const newGuardId = originalGuardId.includes('_v') ? `${originalGuardId.split('_v')[0]}_v${newNode.attempt}` : `${originalGuardId}_v${newNode.attempt}`;

        const newGuardNode = clone(originalGuard);
        newGuardNode.id = newGuardId;
        newGuardNode.dependsOn = [newAgentId]; // Теперь зависит от нового узла
        newGuardNode.status = 'PLANNED';
        newGuardNode.attempt = newNode.attempt;
        newGuardNode.result_data = null;

        nodes.set(originalGuardId, { ...originalGuard, status: 'SKIPPED_RETRY', result_data: { newGuardId } });
        nodes.set(newGuardId, newGuardNode);
        tasks.get(taskId).nodes.push(newGuardId);
    }
    
    return newNode;
  }

  /**
   * Отмечает сбойный GuardAgent и его генеративного предшественника как завершенные для итерации.
   */
  static prepareNodeForRetry(failedGuardNodeId, correctiveNodeId) {
      const failedGuardNode = nodes.get(failedGuardNodeId);
      if (!failedGuardNode) return false;

      // Получаем ID оригинального генеративного узла
      const originalNodeId = failedGuardNode.dependsOn[0];

      // Отмечаем оригинальный генеративный узел как SKIPPED_RETRY (он не FAILED, но не принят)
      TaskStore.updateNodeStatus(originalNodeId, 'SKIPPED_RETRY', { nextAttempt: correctiveNodeId });

      // Отмечаем GuardAgent как SKIPPED_RETRY
      TaskStore.updateNodeStatus(failedGuardNodeId, 'SKIPPED_RETRY', { nextAttempt: correctiveNodeId });
      
      return true;
  }

}