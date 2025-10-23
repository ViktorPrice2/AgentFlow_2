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
    tasks.set(taskId, { name, dagPlan, status: 'CREATED', nodes: [], schedule: [] });

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

  static updateTaskSchedule(taskId, scheduleData) {
    const task = tasks.get(taskId);
    if (!task) {
      return null;
    }

    const normalizedSchedule = Array.isArray(scheduleData)
      ? scheduleData.map(item => ({
          date: item?.date || '',
          type: item?.type || 'post',
          channel: item?.channel || item?.platform || 'organic',
          topic: item?.topic || item?.title || '',
          objective: item?.objective || item?.goal || '',
          notes: item?.notes || item?.cta || '',
          views: Number.isFinite(item?.views) ? item.views : 0,
          likes: Number.isFinite(item?.likes) ? item.likes : 0,
          content: typeof item?.content === 'string' ? item.content : '',
          content_prompt: item?.content_prompt || null,
          image_prompt: item?.image_prompt || null,
          status: item?.status || 'PLANNED_CONTENT',
          last_generated_at: item?.last_generated_at || null,
          last_generated_id: item?.last_generated_id || null,
          generation_error: item?.generation_error || null,
        }))
      : [];

    task.schedule = normalizedSchedule;
    return task.schedule;
  }

  static updateScheduleItem(taskId, index, updates = {}) {
    const task = tasks.get(taskId);
    if (!task || !Array.isArray(task.schedule) || index < 0 || index >= task.schedule.length) {
      return null;
    }

    const target = task.schedule[index];
    if (!target) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'goal')) {
      updates.objective = updates.goal;
      delete updates.goal;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'views')) {
      const parsedViews = Number.parseInt(updates.views, 10);
      target.views = Number.isFinite(parsedViews) ? parsedViews : target.views;
      delete updates.views;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'likes')) {
      const parsedLikes = Number.parseInt(updates.likes, 10);
      target.likes = Number.isFinite(parsedLikes) ? parsedLikes : target.likes;
      delete updates.likes;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'content')) {
      const rawContent = updates.content;
      target.content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '');
      delete updates.content;
    }

    Object.assign(target, updates);
    return target;
  }

  static getTaskSchedule(taskId) {
    const task = tasks.get(taskId);
    return task?.schedule || [];
  }

  static getNode(nodeId) {
    return nodes.get(nodeId);
  }

  static getTask(taskId) {
    return tasks.get(taskId);
  }

  static getAllTasks() {
    return tasks;
  }

  static getAllNodes() {
    return nodes;
  }

  static createTemporaryNode(taskId, agentType, inputData = {}, options = {}) {
    const task = tasks.get(taskId);
    if (!task) {
      return null;
    }

    const suffix = Math.random().toString(16).slice(2, 8);
    const nodeId = `schedule_${agentType}_${Date.now()}_${suffix}`;

    const dependsOn = Array.isArray(options.dependsOn) ? [...options.dependsOn] : [];

    const nodeEntry = {
      id: nodeId,
      taskId,
      agent_type: agentType,
      status: 'PLANNED',
      input_data: clone(inputData),
      dependsOn,
      result_data: null,
      cost: 0,
      attempt: 1,
      is_temporary: true,
    };

    nodes.set(nodeId, nodeEntry);
    return nodeEntry;
  }

  static removeNode(nodeId) {
    nodes.delete(nodeId);
  }

  static reset() {
    tasks.clear();
    nodes.clear();
    taskIdCounter = 1;
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
          return n && (n.status === 'SUCCESS' || n.status === 'FAILED' || n.status === 'MANUALLY_OVERRIDDEN' || n.status === 'SKIPPED_RETRY');
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

    const originalAgentType = originalNode.agent_type;
    const originalAgentBaseId = originalNodeId.replace(/_v\d+$/, '');
    const allAttempts = Array.from(nodes.values()).filter(n =>
      n.agent_type === originalAgentType &&
      n.id.startsWith(originalAgentBaseId)
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
      input_data: { failedGuardNodeId, originalNodeId },
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
    const originalAgentBaseId = originalNodeId.replace(/_v\d+$/, '');
    const newAttempt = (originalNode.attempt || 1) + 1;
    const newAgentId = `${originalAgentBaseId}_v${newAttempt}`;
    
    // Создаем новый GuardAgent, который будет проверять новый генеративный узел
    const originalGuard = Array.from(nodes.values()).find(
      n => n.dependsOn.includes(originalNodeId) && n.agent_type === 'GuardAgent'
    );

    const newNode = {
        id: newAgentId,
        taskId,
        agent_type: originalNode.agent_type,
        status: 'PLANNED',
        input_data: updatedInputData,
        dependsOn: originalNode.dependsOn, // Зависит от тех же узлов, что и оригинал (кроме GuardAgent)
        result_data: null,
        cost: 0,
        attempt: newAttempt,
        is_retry: false,
    };
    nodes.set(newAgentId, newNode);
    tasks.get(taskId).nodes.push(newAgentId);

    // Обновляем GuardAgent (чтобы он зависел от нового узла)
    if (originalGuard) {
        // Узел GuardAgent будет пересоздан для проверки нового генеративного узла. 
        // В упрощенном MVP мы просто обновляем зависимости оригинального GuardAgent.
        const originalGuardId = originalGuard.id;
        const originalGuardBaseId = originalGuardId.replace(/_v\d+$/, '');
        const newGuardId = `${originalGuardBaseId}_v${newAttempt}`;

        const newGuardNode = clone(originalGuard);
        newGuardNode.id = newGuardId;
        newGuardNode.dependsOn = [newAgentId]; // Теперь зависит от нового узла
        newGuardNode.status = 'PLANNED';
        newGuardNode.attempt = newAttempt;
        newGuardNode.result_data = null;
        newGuardNode.cost = 0;

        nodes.set(originalGuardId, { ...originalGuard, status: 'SKIPPED_RETRY', result_data: { nextGuard: newGuardId } });
        nodes.set(newGuardId, newGuardNode);
        tasks.get(taskId).nodes.push(newGuardId);

        // Перенастраиваем зависимости всех последующих узлов, которые ссылались на оригинальный GuardAgent
        const task = tasks.get(taskId);
        if (task) {
          for (const dependentId of task.nodes) {
            const dependentNode = nodes.get(dependentId);
            if (!dependentNode || !Array.isArray(dependentNode.dependsOn) || dependentId === newGuardId) {
              continue;
            }
            if (dependentNode.dependsOn.includes(originalGuardId)) {
              dependentNode.dependsOn = dependentNode.dependsOn.map(dep => (dep === originalGuardId ? newGuardId : dep));
            }
          }
        }
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

      return nodes.get(failedGuardNodeId);
  }

}
