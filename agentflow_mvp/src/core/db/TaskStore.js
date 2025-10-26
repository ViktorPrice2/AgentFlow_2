import fs from 'fs';
import path from 'path';
import '../../utils/loadEnv.js';
import { resolveAppPath } from '../../utils/appPaths.js';

// src/core/db/TaskStore.js

const PERSIST_PATH = resolveAppPath('task_store.json');
const COMPLETED_NODE_STATUSES = new Set(['SUCCESS', 'FAILED', 'MANUALLY_OVERRIDDEN', 'SKIPPED_RETRY']);

const tasks = new Map();
const nodes = new Map(); // nodes и tasks должны быть доступны через TaskStore.get...
let taskIdCounter = 1;

// Вспомогательная функция для клонирования объекта
function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeScheduleItem(item) {
  const candidate = item ?? {};
  const normalized = {
    date: candidate.date || '',
    type: candidate.type || 'post',
    channel: candidate.channel || candidate.platform || '',
    topic: candidate.topic || candidate.title || '',
    objective: candidate.objective ?? candidate.goal ?? '',
    goal: candidate.goal ?? candidate.objective ?? '',
    notes: candidate.notes ?? candidate.cta ?? '',
    views: toInteger(candidate.views),
    likes: toInteger(candidate.likes),
    content: typeof candidate.content === 'string' ? candidate.content : '',
    content_prompt:
      candidate.content_prompt !== undefined
        ? typeof candidate.content_prompt === 'string'
          ? candidate.content_prompt
          : clone(candidate.content_prompt)
        : null,
    image_prompt:
      candidate.image_prompt !== undefined
        ? typeof candidate.image_prompt === 'string'
          ? candidate.image_prompt
          : clone(candidate.image_prompt)
        : null,
    status: candidate.status || 'PLANNED_CONTENT',
    last_generated_at: candidate.last_generated_at || null,
    last_generated_id: candidate.last_generated_id || null,
    generation_error: candidate.generation_error || null,
  };

  if (candidate.tone) {
    normalized.tone = candidate.tone;
  }

  if (candidate.metrics && typeof candidate.metrics === 'object') {
    normalized.metrics = clone(candidate.metrics);
  }

  if (candidate.content_summary) {
    normalized.content_summary = candidate.content_summary;
  }

  return normalized;
}

function normalizeScheduleData(schedule) {
  if (!Array.isArray(schedule)) {
    return [];
  }
  return schedule.map(item => normalizeScheduleItem(item));
}

function normalizeTask(taskId, task) {
  const nodeIds = Array.isArray(task?.nodes)
    ? task.nodes
        .map(id => (typeof id === 'number' ? String(id) : id))
        .filter(id => typeof id === 'string' && id.length > 0)
    : [];

  return {
    id: task?.id || taskId,
    name: task?.name || `Task ${taskId}`,
    dagPlan: clone(task?.dagPlan || {}),
    status: task?.status || 'CREATED',
    nodes: nodeIds,
    schedule: normalizeScheduleData(task?.schedule),
  };
}

function serializeTask(taskId, task) {
  return normalizeTask(taskId, task);
}

function normalizeNode(nodeId, node) {
  const dependsOn = Array.isArray(node?.dependsOn) ? [...node.dependsOn] : [];
  return {
    id: node?.id || nodeId,
    taskId: node?.taskId || null,
    agent_type: node?.agent_type || node?.agent || 'UnknownAgent',
    status: node?.status || 'PLANNED',
    input_data: clone(node?.input_data || node?.input || {}),
    dependsOn,
    result_data: node?.result_data ? clone(node.result_data) : null,
    cost: Number.isFinite(node?.cost) ? node.cost : 0,
    attempt: Number.isFinite(node?.attempt) ? node.attempt : 1,
    is_retry: Boolean(node?.is_retry),
    is_temporary: Boolean(node?.is_temporary),
  };
}

function serializeNode(nodeId, node) {
  return normalizeNode(nodeId, node);
}

function ensureTaskStatusConsistency(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    return;
  }

  const nodeEntries = task.nodes.map(id => nodes.get(id)).filter(Boolean);
  if (nodeEntries.length === 0) {
    if (task.status !== 'CREATED') {
      task.status = 'CREATED';
    }
    return;
  }

  const allCompleted = nodeEntries.every(node => COMPLETED_NODE_STATUSES.has(node.status));
  const anyFailed = nodeEntries.some(node => node.status === 'FAILED');
  const anyRunning = nodeEntries.some(node => node.status === 'RUNNING');
  const anyPlanned = nodeEntries.some(node => node.status === 'PLANNED');
  const anyPaused = nodeEntries.some(node => node.status === 'PAUSED');

  if (allCompleted) {
    task.status = anyFailed ? 'FAILED' : 'COMPLETED';
    return;
  }

  if (anyPaused && !anyRunning) {
    task.status = 'PAUSED';
    return;
  }

  if (anyRunning) {
    task.status = 'RUNNING';
    return;
  }

  if (anyPlanned) {
    task.status = task.status === 'CREATED' ? 'CREATED' : 'RUNNING';
  }
}

function computeNextTaskIdCounter() {
  const numericIds = Array.from(tasks.keys())
    .map(id => Number.parseInt(String(id).replace(/\D+/g, ''), 10))
    .filter(Number.isFinite);
  const maxId = numericIds.length ? Math.max(...numericIds) : 0;
  taskIdCounter = Math.max(taskIdCounter, maxId + 1);
}

export class TaskStore {
  static createTask(name, dagPlan) {
    const taskId = `task_${taskIdCounter++}`;
    const dagCopy = clone(dagPlan || {});
    const taskRecord = {
      id: taskId,
      name,
      dagPlan: dagCopy,
      status: 'CREATED',
      nodes: [],
      schedule: [],
    };

    tasks.set(taskId, taskRecord);

    const definedNodes = Array.isArray(dagPlan?.nodes) ? dagPlan.nodes : [];
    for (const nodeDef of definedNodes) {
      const nodeId = `${nodeDef.id}`;
      const entry = normalizeNode(nodeId, {
        ...nodeDef,
        id: nodeId,
        taskId,
        agent_type: nodeDef.agent || nodeDef.agent_type,
        status: 'PLANNED',
        input_data: clone(nodeDef.input),
        dependsOn: Array.isArray(nodeDef.dependsOn) ? [...nodeDef.dependsOn] : [],
        result_data: null,
        cost: 0,
        attempt: 1,
      });

      nodes.set(nodeId, entry);
      taskRecord.nodes.push(nodeId);
    }

    TaskStore.saveToDisk();
    return taskId;
  }

  static updateTaskSchedule(taskId, scheduleData) {
    const task = tasks.get(taskId);
    if (!task) {
      return null;
    }

    task.schedule = normalizeScheduleData(scheduleData);
    TaskStore.saveToDisk();
    return task.schedule;
  }

  static deleteTask(taskId) {
    const task = tasks.get(taskId);
    if (!task) {
      return false;
    }

    const taskNodeIds = new Set(Array.isArray(task.nodes) ? task.nodes : []);

    for (const [nodeId, node] of Array.from(nodes.entries())) {
      if (node?.taskId === taskId || taskNodeIds.has(nodeId)) {
        nodes.delete(nodeId);
      }
    }

    tasks.delete(taskId);
    TaskStore.saveToDisk();
    return true;
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
      const normalizedGoal = updates.goal;
      target.goal = normalizedGoal;
      target.objective = normalizedGoal;
      delete updates.goal;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'objective')) {
      const normalizedObjective = updates.objective;
      target.objective = normalizedObjective;
      target.goal = normalizedObjective;
      delete updates.objective;
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
    TaskStore.saveToDisk();
    return target;
  }

  static saveToDisk() {
    const data = {
      taskIdCounter,
      tasks: Array.from(tasks.entries()).map(([id, task]) => [id, serializeTask(id, task)]),
      nodes: Array.from(nodes.entries()).map(([id, node]) => [id, serializeNode(id, node)]),
    };

    try {
      fs.writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[TaskStore] Failed to save data to disk:', error.message);
    }
  }

  static loadFromDisk() {
    if (!fs.existsSync(PERSIST_PATH)) {
      return;
    }

    try {
      const raw = fs.readFileSync(PERSIST_PATH, 'utf-8');
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      tasks.clear();
      nodes.clear();

      const persistedTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      for (const [taskId, taskData] of persistedTasks) {
        const normalizedTask = normalizeTask(taskId, taskData);
        tasks.set(taskId, normalizedTask);
      }

      const persistedNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      for (const [nodeId, nodeData] of persistedNodes) {
        const normalizedNode = normalizeNode(nodeId, nodeData);
        if (!normalizedNode.taskId || !tasks.has(normalizedNode.taskId)) {
          continue;
        }
        nodes.set(nodeId, normalizedNode);
      }

      for (const [taskId, task] of tasks.entries()) {
        task.nodes = task.nodes.filter(nodeId => nodes.has(nodeId));
        ensureTaskStatusConsistency(taskId);
      }

      const persistedCounter = Number.parseInt(parsed.taskIdCounter, 10);
      taskIdCounter = Number.isFinite(persistedCounter) && persistedCounter > 0 ? persistedCounter : 1;
      computeNextTaskIdCounter();

      console.log(`[TaskStore] Loaded ${tasks.size} tasks (${nodes.size} nodes) from disk.`);
    } catch (error) {
      console.error('[TaskStore] Failed to load data from disk:', error.message);
      tasks.clear();
      nodes.clear();
      taskIdCounter = 1;
    }
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

    const nodeEntry = normalizeNode(nodeId, {
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
    });

    nodes.set(nodeId, nodeEntry);
    TaskStore.saveToDisk();
    return nodeEntry;
  }

  static removeNode(nodeId) {
    nodes.delete(nodeId);
    TaskStore.saveToDisk();
  }

  static reset() {
    tasks.clear();
    nodes.clear();
    taskIdCounter = 1;
    try {
      if (fs.existsSync(PERSIST_PATH)) {
        fs.unlinkSync(PERSIST_PATH);
      }
    } catch (error) {
      console.error('[TaskStore] Failed to clear persisted state:', error.message);
    }
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
    if (!node) {
      return null;
    }

    node.status = status;
    if (resultData) {
      node.result_data = { ...node.result_data, ...resultData };
    }
    node.cost = (node.cost || 0) + cost;

    if (node.taskId && tasks.has(node.taskId)) {
      const task = tasks.get(node.taskId);
      if (status === 'PAUSED') {
        task.status = 'PAUSED';
      } else if (status === 'RUNNING' && task.status !== 'RUNNING') {
        task.status = 'RUNNING';
      }
      ensureTaskStatusConsistency(node.taskId);
    }

    TaskStore.saveToDisk();
    return node;
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

    const newNode = normalizeNode(retryNodeId, {
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
    });

    nodes.set(retryNodeId, newNode);
    tasks.get(taskId).nodes.push(retryNodeId);
    TaskStore.saveToDisk();
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

    const newNode = normalizeNode(newAgentId, {
      id: newAgentId,
      taskId,
      agent_type: originalNode.agent_type,
      status: 'PLANNED',
      input_data: clone(updatedInputData),
      dependsOn: Array.isArray(originalNode.dependsOn) ? [...originalNode.dependsOn] : [],
      result_data: null,
      cost: 0,
      attempt: newAttempt,
      is_retry: false,
    });
    nodes.set(newAgentId, newNode);
    tasks.get(taskId).nodes.push(newAgentId);

    // Обновляем GuardAgent (чтобы он зависел от нового узла)
    if (originalGuard) {
        // Узел GuardAgent будет пересоздан для проверки нового генеративного узла. 
        // В упрощенном MVP мы просто обновляем зависимости оригинального GuardAgent.
        const originalGuardId = originalGuard.id;
        const originalGuardBaseId = originalGuardId.replace(/_v\d+$/, '');
        const newGuardId = `${originalGuardBaseId}_v${newAttempt}`;

        const newGuardNode = normalizeNode(newGuardId, {
          ...originalGuard,
          id: newGuardId,
          taskId,
          dependsOn: [newAgentId],
          status: 'PLANNED',
          attempt: newAttempt,
          result_data: null,
          cost: 0,
        });

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

    TaskStore.saveToDisk();
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

  /**
   * Создает новый цикл из HumanGate и StrategyReviewAgent, чтобы продолжить стратегическое планирование.
   * @param {string} taskId
   * @param {string} lastNodeId
   * @returns {{ newHumanGateId: string, newStrategyReviewId: string } | null}
   */
  static createNextStrategyCycle(taskId, lastNodeId) {
    const task = tasks.get(taskId);
    if (!task) {
      return null;
    }

    const lastNode = nodes.get(lastNodeId);
    if (!lastNode || lastNode.taskId !== taskId) {
      return null;
    }

    const baseStrategyId = lastNodeId.replace(/_v\d+$/, '');
    const dependencyBaseId = Array.isArray(lastNode.dependsOn) && lastNode.dependsOn.length > 0
      ? lastNode.dependsOn[0].replace(/_v\d+$/, '')
      : 'node3_human_review';

    const existingReviewNodes = Array.from(nodes.values()).filter(
      node => node?.taskId === taskId && node.id.startsWith(baseStrategyId) && node.agent_type === 'StrategyReviewAgent'
    );

    let cycleIndex = existingReviewNodes.length;
    let newHumanGateId = `${dependencyBaseId}_v${cycleIndex}`;
    let newStrategyReviewId = `${baseStrategyId}_v${cycleIndex}`;

    while (nodes.has(newHumanGateId) || nodes.has(newStrategyReviewId)) {
      cycleIndex += 1;
      newHumanGateId = `${dependencyBaseId}_v${cycleIndex}`;
      newStrategyReviewId = `${baseStrategyId}_v${cycleIndex}`;
    }

    const humanGateNode = normalizeNode(newHumanGateId, {
      id: newHumanGateId,
      taskId,
      agent_type: 'HumanGateAgent',
      status: 'PLANNED',
      input_data: {
        reason: `Awaiting metrics input and strategy review for Cycle ${cycleIndex}.`,
      },
      dependsOn: [lastNodeId],
    });

    const strategyReviewNode = normalizeNode(newStrategyReviewId, {
      id: newStrategyReviewId,
      taskId,
      agent_type: 'StrategyReviewAgent',
      status: 'PLANNED',
      input_data: { review_period: `Cycle ${cycleIndex}` },
      dependsOn: [newHumanGateId],
    });

    nodes.set(newHumanGateId, humanGateNode);
    nodes.set(newStrategyReviewId, strategyReviewNode);
    task.nodes.push(newHumanGateId, newStrategyReviewId);

    ensureTaskStatusConsistency(taskId);
    TaskStore.saveToDisk();

    return { newHumanGateId, newStrategyReviewId };
  }

}
