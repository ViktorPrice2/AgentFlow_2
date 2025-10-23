function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

export class TaskStore {
  static tasks = new Map();
  static nodes = new Map();
  static taskIdCounter = 1;

  static reset() {
    TaskStore.tasks = new Map();
    TaskStore.nodes = new Map();
    TaskStore.taskIdCounter = 1;
  }

  static createTask(name, dagPlan) {
    const taskId = `task_${TaskStore.taskIdCounter++}`;
    TaskStore.tasks.set(taskId, { name, dagPlan, status: 'CREATED', nodes: [] });

    for (const nodeDef of dagPlan.nodes) {
      const nodeId = `${nodeDef.id}`;
      TaskStore.nodes.set(nodeId, {
        id: nodeId,
        taskId,
        agent_type: nodeDef.agent,
        agent: nodeDef.agent,
        status: 'PLANNED',
        input_data: clone(nodeDef.input) || {},
        dependsOn: [...(nodeDef.dependsOn || [])],
        result_data: null,
        cost: 0,
      });
      TaskStore.tasks.get(taskId).nodes.push(nodeId);
    }
    return taskId;
  }

  static getNode(nodeId) {
    return TaskStore.nodes.get(nodeId);
  }

  static getTask(taskId) {
    return TaskStore.tasks.get(taskId);
  }

  static getReadyNodes(taskId) {
    const task = TaskStore.tasks.get(taskId);
    if (!task || (task.status !== 'RUNNING' && task.status !== 'CREATED')) return [];

    const readyNodes = [];
    for (const nodeId of task.nodes) {
      const node = TaskStore.nodes.get(nodeId);
      if (!node || node.status !== 'PLANNED') continue;

      const allDepsMet = node.dependsOn.every(depId => {
        const depNode = TaskStore.nodes.get(depId);
        return depNode && depNode.status === 'SUCCESS';
      });

      if (allDepsMet) {
        readyNodes.push(node);
      }
    }
    return readyNodes;
  }

  static updateNodeStatus(nodeId, status, resultData = null, cost = 0) {
    const node = TaskStore.nodes.get(nodeId);
    if (!node) return null;

    node.status = status;
    if (resultData !== null) {
      node.result_data = resultData;
    }
    node.cost += cost;

    const task = TaskStore.tasks.get(node.taskId);
    if (!task) return node;

    if (status === 'RUNNING' && task.status === 'CREATED') {
      task.status = 'RUNNING';
    }

    const terminalStatuses = new Set(['SUCCESS', 'FAILED', 'MANUALLY_OVERRIDDEN', 'SKIPPED']);

    if (terminalStatuses.has(status)) {
      const allCompleted = task.nodes.every(id => {
        const n = TaskStore.nodes.get(id);
        return n && terminalStatuses.has(n.status);
      });
      if (allCompleted && task.status !== 'FAILED') {
        task.status = 'COMPLETED';
      }
    }

    return node;
  }

  static getResult(nodeId) {
    const node = TaskStore.nodes.get(nodeId);
    return node ? node.result_data : null;
  }

  static createRetryAgentNode(taskId, failedNodeId) {
    const task = TaskStore.tasks.get(taskId);
    if (!task) return null;

    const existing = task.nodes
      .map(id => TaskStore.nodes.get(id))
      .find(
        node =>
          node &&
          node.agent_type === 'RetryAgent' &&
          node.input_data?.failedNodeId === failedNodeId &&
          (node.status === 'PLANNED' || node.status === 'RUNNING')
      );

    if (existing) {
      return existing;
    }

    let suffix = 1;
    let newId = `retry_${failedNodeId}`;
    while (TaskStore.nodes.has(newId)) {
      suffix += 1;
      newId = `retry_${failedNodeId}_${suffix}`;
    }

    const retryNode = {
      id: newId,
      taskId,
      agent_type: 'RetryAgent',
      agent: 'RetryAgent',
      status: 'PLANNED',
      input_data: { failedNodeId },
      dependsOn: [],
      result_data: null,
      cost: 0,
    };

    TaskStore.nodes.set(newId, retryNode);
    task.nodes.push(newId);
    task.status = task.status === 'COMPLETED' ? 'RUNNING' : task.status;
    return retryNode;
  }

  static createCorrectiveNode(originalNodeId, overrides = {}) {
    if (arguments.length > 2) {
      const [taskId, newNodeId, agentType, inputData, dependsOn] = arguments;
      const task = TaskStore.tasks.get(taskId);
      if (!task || TaskStore.nodes.has(newNodeId)) {
        return null;
      }

      const newNode = {
        id: newNodeId,
        taskId,
        agent_type: agentType,
        agent: agentType,
        status: 'PLANNED',
        input_data: clone(inputData) || {},
        dependsOn: [...(dependsOn || [])],
        result_data: null,
        cost: 0,
      };

      TaskStore.nodes.set(newNodeId, newNode);
      task.nodes.push(newNodeId);
      task.status = 'RUNNING';
      return newNode;
    }

    const originalNode = TaskStore.nodes.get(originalNodeId);
    if (!originalNode) return null;
    const task = TaskStore.tasks.get(originalNode.taskId);
    if (!task) return null;

    const rootId = originalNode.retryOf || originalNodeId;

    let maxVersion = 1;
    for (const nodeId of task.nodes) {
      if (nodeId === rootId) {
        maxVersion = Math.max(maxVersion, 1);
        continue;
      }
      const match = nodeId.match(new RegExp(`^${rootId}_v(\\d+)$`));
      if (match) {
        maxVersion = Math.max(maxVersion, Number(match[1]));
      }
    }

    const newVersion = maxVersion + 1;
    const newId = `${rootId}_v${newVersion}`;

    const newNode = {
      id: newId,
      taskId: originalNode.taskId,
      agent_type: originalNode.agent_type,
      agent: originalNode.agent || originalNode.agent_type,
      status: 'PLANNED',
      input_data: overrides.input_data ? clone(overrides.input_data) : clone(originalNode.input_data) || {},
      dependsOn: overrides.dependsOn ? [...overrides.dependsOn] : [...originalNode.dependsOn],
      result_data: null,
      cost: 0,
      retryOf: rootId,
    };

    TaskStore.nodes.set(newId, newNode);
    task.nodes.push(newId);
    task.status = task.status === 'COMPLETED' ? 'RUNNING' : task.status;
    return newNode;
  }

  static prepareNodeForRetry(nodeId, newDependencyId) {
    const node = TaskStore.nodes.get(nodeId);
    if (!node) return null;

    if (newDependencyId) {
      if (node.dependsOn && node.dependsOn.length > 0) {
        node.dependsOn = [newDependencyId, ...node.dependsOn.slice(1)];
      } else {
        node.dependsOn = [newDependencyId];
      }
    }

    const maxRetryAttempts = Number(process.env.MAX_RETRY_ATTEMPTS || 3);
    node.retryAttempts = (node.retryAttempts || 0) + 1;

    if (node.retryAttempts > maxRetryAttempts) {
      node.status = 'FAILED';
      node.result_data = {
        reason: `Max retry attempts (${maxRetryAttempts}) exceeded.`,
      };
      return node;
    }

    node.status = 'PLANNED';
    node.result_data = null;

    const task = TaskStore.tasks.get(node.taskId);
    if (task) {
      task.status = 'RUNNING';
    }

    return node;
  }
}
