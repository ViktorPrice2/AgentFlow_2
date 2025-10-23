import express from 'express';
import { createServer } from 'http';
import { Server as SocketIoServer } from 'socket.io';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { MasterAgent } from './agents/MasterAgent.js';
import { TaskStore } from './core/db/TaskStore.js';
import { Logger } from './core/Logger.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketIoServer(httpServer);
const PORT = process.env.PORT || 3000;

const DAG_PATH = path.join(process.cwd(), 'plans', 'dag.json');
let dagTemplate = '{}';
try {
  dagTemplate = fs.readFileSync(DAG_PATH, 'utf-8');
} catch (error) {
  console.warn(`Failed to load DAG template at ${DAG_PATH}:`, error.message);
}

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

const broadcastTaskUpdate = taskId => {
  const taskData = TaskStore.getTask(taskId);
  if (!taskData) return;

  const nodes = taskData.nodes
    .map(id => TaskStore.getNode(id))
    .filter(Boolean)
    .map(node => ({ ...node }));

  io.emit('task-update', {
    taskId,
    status: taskData.status,
    nodes,
  });
};

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.post('/api/tasks/start', async (req, res) => {
  try {
    const { taskName, taskTopic, taskTone } = req.body || {};
    const plan = JSON.parse(dagTemplate);

    if (!plan?.nodes?.length) {
      return res.status(500).json({ success: false, message: 'DAG template is empty.' });
    }

    plan.task_name = taskName || plan.task_name;
    plan.nodes[0].input = { topic: taskTopic, tone: taskTone };

    const taskId = TaskStore.createTask(plan.task_name || 'AgentFlow Task', plan);

    broadcastTaskUpdate(taskId);

    res.json({ success: true, taskId, message: `Task ${taskId} created. Scheduler starting...` });

    MasterAgent.runScheduler(taskId, broadcastTaskUpdate).catch(error => {
      console.error(`Scheduler error for ${taskId}:`, error);
      const task = TaskStore.getTask(taskId);
      if (task) {
        task.status = 'FAILED';
      }
      broadcastTaskUpdate(taskId);
    });
  } catch (error) {
    console.error('Failed to start task:', error);
    res.status(500).json({ success: false, message: 'Failed to start task.', error: error.message });
  }
});

app.get('/api/tasks', (req, res) => {
  const tasksMap = TaskStore.tasks instanceof Map ? TaskStore.tasks : new Map();
  const tasksList = Array.from(tasksMap.entries()).map(([id, task]) => ({
    id,
    name: task.name,
    status: task.status,
    nodeCount: task.nodes.length,
  }));
  res.json(tasksList);
});

app.get('/api/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = TaskStore.getTask(taskId);
  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }

  const nodes = task.nodes.map(nodeId => TaskStore.getNode(nodeId)).filter(Boolean);
  res.json({ task, nodes });
});

app.get('/api/logs/:taskId/:nodeId', (req, res) => {
  const logPath = path.join(process.cwd(), 'logs', `${req.params.taskId}.log.jsonl`);
  if (!fs.existsSync(logPath)) {
    return res.status(404).send('Log file not found.');
  }
  res.sendFile(logPath);
});

app.post('/api/tasks/:taskId/restart/:nodeId', (req, res) => {
  const { taskId, nodeId } = req.params;
  const { newPrompt } = req.body || {};

  const node = TaskStore.getNode(nodeId);
  if (!node || node.taskId !== taskId) {
    return res.status(404).json({ success: false, message: 'Node not found for this task.' });
  }

  if (node.status !== 'FAILED') {
    return res.status(400).json({ success: false, message: 'Node is not in FAILED state.' });
  }

  const dependencyId = node.dependsOn?.[0];
  if (!dependencyId) {
    return res.status(400).json({ success: false, message: 'Node has no dependency to correct.' });
  }

  const dependencyNode = TaskStore.getNode(dependencyId);
  if (!dependencyNode) {
    return res.status(404).json({ success: false, message: 'Dependency node not found.' });
  }

  let parsedInput;
  if (typeof newPrompt === 'string') {
    try {
      parsedInput = JSON.parse(newPrompt);
    } catch (error) {
      parsedInput = { promptOverride: newPrompt };
    }
  } else if (newPrompt && typeof newPrompt === 'object') {
    parsedInput = { ...newPrompt };
  }

  if (!parsedInput || typeof parsedInput !== 'object') {
    parsedInput = { promptOverride: String(newPrompt ?? '') };
  }

  if (!parsedInput.promptOverride) {
    parsedInput.promptOverride = typeof newPrompt === 'string' ? newPrompt : JSON.stringify(newPrompt);
  }

  parsedInput.retryCount = (dependencyNode.input_data?.retryCount || 0) + 1;

  const correctiveNode = TaskStore.createCorrectiveNode(dependencyId, parsedInput);

  if (!correctiveNode) {
    return res.status(500).json({ success: false, message: 'Failed to create corrective node.' });
  }

  const preparedNode = TaskStore.prepareNodeForRetry(nodeId, correctiveNode.id);

  if (!preparedNode) {
    return res.status(500).json({ success: false, message: 'Failed to prepare node for retry.' });
  }

  if (preparedNode.status === 'FAILED') {
    return res.status(400).json({
      success: false,
      message: preparedNode.result_data?.reason || 'Retry attempts exceeded.',
    });
  }

  const logger = new Logger(taskId);
  logger.logStep(nodeId, 'MANUAL_RETRY', {
    correctiveNodeId: correctiveNode.id,
    promptOverride: parsedInput.promptOverride,
  });

  const task = TaskStore.getTask(taskId);
  if (task) {
    task.status = 'RUNNING';
  }

  broadcastTaskUpdate(taskId);

  MasterAgent.runScheduler(taskId, broadcastTaskUpdate).catch(error => {
    console.error(`Scheduler error for ${taskId}:`, error);
    const currentTask = TaskStore.getTask(taskId);
    if (currentTask) {
      currentTask.status = 'FAILED';
    }
    broadcastTaskUpdate(taskId);
  });

  res.json({
    success: true,
    correctiveNodeId: correctiveNode.id,
    message: 'Manual correction applied. Scheduler restarted.',
  });
});

httpServer.listen(PORT, () => {
  console.log(`\nAgentFlow Web UI running at http://localhost:${PORT}`);
});
