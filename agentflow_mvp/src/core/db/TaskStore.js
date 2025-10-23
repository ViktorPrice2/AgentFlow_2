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
        status: 'PLANNED',
        input_data: nodeDef.input,
        dependsOn: nodeDef.dependsOn || [],
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

    if (status === 'SUCCESS' || status === 'FAILED') {
      const allCompleted = task.nodes.every(id => {
        const n = TaskStore.nodes.get(id);
        return n && (n.status === 'SUCCESS' || n.status === 'FAILED');
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
}
