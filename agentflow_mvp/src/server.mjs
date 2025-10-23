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
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const RESULTS_DIR = path.join(process.cwd(), 'results');
const LOGS_DIR = path.join(process.cwd(), 'logs');

let dagTemplate = '{}';
try {
  dagTemplate = fs.readFileSync(DAG_PATH, 'utf-8');
} catch (error) {
  console.warn(`Failed to load DAG template at ${DAG_PATH}:`, error.message);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(PUBLIC_DIR));

if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}
app.use('/results', express.static(RESULTS_DIR));

const applyMediaPreferences = (plan, { includeImage = true, includeVideo = false } = {}) => {
  if (!plan || !Array.isArray(plan.nodes)) {
    return plan;
  }

  const nodesToKeep = [];
  const removedIds = new Set();

  for (const node of plan.nodes) {
    const isImageNode =
      node.agent === 'ImageAgent' ||
      node.agent_type === 'ImageAgent' ||
      node.input?.check === 'image_quality';

    const videoChecks = new Set(['video_quality', 'storyboard_validity']);
    const isVideoNode =
      node.agent === 'VideoAgent' ||
      node.agent_type === 'VideoAgent' ||
      (node.input && videoChecks.has(node.input.check));

    if ((!includeImage && isImageNode) || (!includeVideo && isVideoNode)) {
      removedIds.add(node.id);
      continue;
    }

    nodesToKeep.push({
      ...node,
      dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : [],
    });
  }

  if (removedIds.size > 0) {
    for (const node of nodesToKeep) {
      if (Array.isArray(node.dependsOn) && node.dependsOn.length) {
        node.dependsOn = node.dependsOn.filter(dep => !removedIds.has(dep));
      }
    }
  }

  return { ...plan, nodes: nodesToKeep };
};

const broadcastTaskUpdate = taskId => {
  const taskData = TaskStore.getTask(taskId);
  if (!taskData) return;

  const nodes = taskData.nodes
    .map(id => TaskStore.getNode(id))
    .filter(Boolean)
    .map(node => ({ ...node, agent: node.agent_type }));

  const schedule = TaskStore.getTaskSchedule(taskId);

  io.emit('task-update', {
    taskId,
    status: taskData.status,
    nodes,
    schedule,
  });
};

const loadAgentModule = async agentType => {
  switch (agentType) {
    case 'WriterAgent': {
      const { WriterAgent } = await import('./agents/WriterAgent.js');
      return WriterAgent;
    }
    case 'ImageAgent': {
      const { ImageAgent } = await import('./agents/ImageAgent.js');
      return ImageAgent;
    }
    case 'VideoAgent': {
      const { VideoAgent } = await import('./agents/VideoAgent.js');
      return VideoAgent;
    }
    default:
      return null;
  }
};

const getTaskDefaultWriterNode = task => {
  const nodes = task?.dagPlan?.nodes;
  if (!Array.isArray(nodes)) {
    return null;
  }
  return nodes.find(node => (node.agent || node.agent_type) === 'WriterAgent') || null;
};

const getTaskDefaultTone = task => {
  const writerNode = getTaskDefaultWriterNode(task);
  return writerNode?.input?.tone || writerNode?.input_data?.tone || null;
};

const getTaskDefaultTopic = task => {
  const writerNode = getTaskDefaultWriterNode(task);
  return writerNode?.input?.topic || writerNode?.input_data?.topic || '';
};

const determineAgentTypeForScheduleItem = scheduleItem => {
  const type = (scheduleItem?.type || '').toLowerCase();
  if (type.includes('video')) return 'VideoAgent';
  if (
    type.includes('image') ||
    type.includes('visual') ||
    type.includes('graphic') ||
    type.includes('design') ||
    type.includes('creative')
  ) {
    return 'ImageAgent';
  }
  return 'WriterAgent';
};

const composeSchedulePrompt = (scheduleItem, task) => {
  const typeLabel = scheduleItem?.type || 'контент';
  const channel = scheduleItem?.channel || 'основного канала';
  const promptParts = [
    `Создай ${typeLabel} для ${channel}.`,
    scheduleItem?.topic ? `Тема: ${scheduleItem.topic}.` : '',
    scheduleItem?.objective ? `Цель: ${scheduleItem.objective}.` : '',
    scheduleItem?.notes ? `Особые заметки: ${scheduleItem.notes}.` : '',
    scheduleItem?.date ? `Дата публикации: ${scheduleItem.date}.` : '',
  ].filter(Boolean);

  if (promptParts.length === 0) {
    const fallbackTopic = scheduleItem?.topic || getTaskDefaultTopic(task) || task?.name || 'кампании';
    return `Создай ${typeLabel} на тему ${fallbackTopic}.`;
  }

  return promptParts.join(' ');
};

const buildScheduleContext = (scheduleItem, promptText) => {
  const previousContent = typeof scheduleItem?.content === 'string' ? scheduleItem.content.trim() : '';
  return {
    date: scheduleItem?.date || '',
    type: scheduleItem?.type || '',
    channel: scheduleItem?.channel || '',
    topic: scheduleItem?.topic || '',
    objective: scheduleItem?.objective || '',
    notes: scheduleItem?.notes || '',
    summary: promptText,
    previousContent,
    script: previousContent,
    visualPrompt: previousContent,
  };
};

const mapGenerationResultToContent = (agentType, result) => {
  if (agentType === 'WriterAgent') {
    return {
      content: (result?.text || '').trim(),
      payload: result,
    };
  }

  if (agentType === 'ImageAgent') {
    const prompt = result?.finalImagePrompt || result?.prompt || '';
    return {
      content: typeof prompt === 'string' ? prompt.trim() : '',
      payload: result,
    };
  }

  if (agentType === 'VideoAgent') {
    const prompt = result?.final_video_prompt || '';
    const serialized = result ? JSON.stringify(result, null, 2) : '';
    return {
      content: prompt ? prompt.trim() : serialized,
      payload: result,
    };
  }

  return {
    content: '',
    payload: result,
  };
};

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.post('/api/tasks/start', async (req, res) => {
  try {
    const {
      taskName,
      taskTopic,
      taskTone,
      includeImage,
      includeVideo,
      contentFormat,
    } = req.body || {};
    const plan = JSON.parse(dagTemplate);

    if (!plan?.nodes?.length) {
      return res.status(500).json({ success: false, message: 'DAG template is empty.' });
    }

    plan.task_name = taskName || plan.task_name;

    const normalizeFormat = raw => {
      if (!Array.isArray(raw)) {
        return [];
      }

      return raw
        .map(entry => {
          if (!entry) return null;
          if (typeof entry === 'string') {
            const trimmed = entry.trim();
            return trimmed ? { label: 'note', value: trimmed } : null;
          }
          if (typeof entry === 'object') {
            const label = entry.label || entry.name || entry.field || entry.title || entry.key || '';
            const value = entry.value ?? entry.detail ?? entry.description ?? entry.text ?? '';
            if (!label && !value) {
              return null;
            }
            return { label, value };
          }
          return { label: 'note', value: String(entry) };
        })
        .filter(Boolean);
    };

    const normalizedFormat = normalizeFormat(contentFormat);

    const getFormatClone = () => normalizedFormat.map(entry => ({ ...entry }));

    plan.nodes.forEach(node => {
      const agentType = node.agent || node.agent_type;
      const isWriter = agentType === 'WriterAgent';
      const isProductAnalysis = agentType === 'ProductAnalysisAgent';
      const isStrategy = agentType === 'StrategyAgent';

      if (isWriter) {
        node.input = {
          ...node.input,
          topic: taskTopic ?? node.input?.topic,
          tone: taskTone ?? node.input?.tone,
          format: getFormatClone(),
        };
      }

      if (isProductAnalysis || isStrategy) {
        node.input = {
          ...node.input,
          topic: taskTopic ?? node.input?.topic,
          format: getFormatClone(),
        };
      }
    });

    const includeImageFlag = includeImage === undefined ? true : includeImage === true || includeImage === 'true';
    const includeVideoFlag = includeVideo === true || includeVideo === 'true';

    const customizedPlan = applyMediaPreferences(plan, {
      includeImage: includeImageFlag,
      includeVideo: includeVideoFlag,
    });

    const taskId = TaskStore.createTask(
      customizedPlan.task_name || 'AgentFlow Task',
      customizedPlan
    );

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
  const tasksMap = TaskStore.getAllTasks();
  const entries = tasksMap instanceof Map ? tasksMap.entries() : [];
  const tasksList = Array.from(entries).map(([id, task]) => ({
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
  const schedule = TaskStore.getTaskSchedule(taskId);

  res.json({ task, nodes, schedule });
});

app.get('/api/tasks/:taskId/schedule', (req, res) => {
  const { taskId } = req.params;
  const schedule = TaskStore.getTaskSchedule(taskId);
  if (!schedule) {
    return res.status(404).json({ success: false, message: 'Task or schedule not found.' });
  }

  res.json({ taskId, schedule });
});

app.post('/api/tasks/:taskId/schedule/update', (req, res) => {
  const { taskId } = req.params;
  const { index, ...updates } = req.body || {};

  const parsedIndex = Number.parseInt(index, 10);
  if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
    return res.status(400).json({ success: false, message: 'Index is required and must be a valid integer.' });
  }

  const updatedItem = TaskStore.updateScheduleItem(taskId, parsedIndex, updates);
  if (!updatedItem) {
    return res.status(404).json({ success: false, message: 'Schedule item not found.' });
  }

  broadcastTaskUpdate(taskId);
  res.json({ success: true, scheduleItem: updatedItem });
});

app.post('/api/tasks/:taskId/schedule/generate/:index', async (req, res) => {
  const { taskId, index } = req.params;

  const parsedIndex = Number.parseInt(index, 10);
  if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
    return res.status(400).json({ success: false, message: 'Index must be a valid integer.' });
  }

  const task = TaskStore.getTask(taskId);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found.' });
  }

  const schedule = TaskStore.getTaskSchedule(taskId);
  const scheduleItem = schedule?.[parsedIndex];
  if (!scheduleItem) {
    return res.status(404).json({ success: false, message: 'Schedule item not found.' });
  }

  const agentType = determineAgentTypeForScheduleItem(scheduleItem);
  const promptText = composeSchedulePrompt(scheduleItem, task);
  const scheduleContext = buildScheduleContext(scheduleItem, promptText);
  const tone = scheduleItem?.tone || getTaskDefaultTone(task) || 'enthusiastic';
  const topic = scheduleItem?.topic || getTaskDefaultTopic(task) || task?.name || 'кампанию';

  const inputData = {
    topic,
    tone,
    promptOverride: promptText,
    description: promptText,
    scheduleContext,
  };

  if (agentType === 'ImageAgent') {
    inputData.description = promptText;
  }

  if (agentType === 'VideoAgent') {
    inputData.scheduleContext = {
      ...scheduleContext,
      script: scheduleContext.previousContent || scheduleContext.summary,
    };
  }

  const tempNode = TaskStore.createTemporaryNode(taskId, agentType, inputData);
  if (!tempNode) {
    return res.status(500).json({ success: false, message: 'Unable to prepare temporary node for generation.' });
  }

  TaskStore.updateScheduleItem(taskId, parsedIndex, {
    status: 'CONTENT_GENERATING',
    generation_error: null,
  });
  broadcastTaskUpdate(taskId);

  res.json({
    success: true,
    message: `Запущена генерация контента (${agentType}) для элемента ${parsedIndex + 1}.`,
  });

  try {
    tempNode.status = 'RUNNING';
    const AgentModule = await loadAgentModule(agentType);
    if (!AgentModule || typeof AgentModule.execute !== 'function') {
      throw new Error(`Agent module ${agentType} is not available.`);
    }

    const result = await AgentModule.execute(tempNode.id);
    const { content, payload } = mapGenerationResultToContent(agentType, result);

    TaskStore.updateScheduleItem(taskId, parsedIndex, {
      content,
      content_prompt: payload,
      status: 'CONTENT_READY',
      last_generated_at: new Date().toISOString(),
      last_generated_id: tempNode.id,
      generation_error: null,
    });
    broadcastTaskUpdate(taskId);
  } catch (error) {
    console.error(`Error generating content for task ${taskId} schedule index ${parsedIndex}:`, error);
    TaskStore.updateScheduleItem(taskId, parsedIndex, {
      status: 'CONTENT_FAILED',
      generation_error: error?.message || 'Generation failed.',
    });
    broadcastTaskUpdate(taskId);
  } finally {
    TaskStore.removeNode(tempNode.id);
  }
});

app.get('/api/logs/:taskId', (req, res) => {
  const { taskId } = req.params;
  const logPath = path.join(LOGS_DIR, `${taskId}.log.jsonl`);
  if (!fs.existsSync(logPath)) {
    return res.status(404).send('Log file not found.');
  }

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (error) {
    console.error(`Failed to read log for ${taskId}:`, error);
    res.status(500).send('Unable to read log file.');
  }
});

app.get('/api/logs/:taskId/:nodeId', (req, res) => {
  const logPath = path.join(LOGS_DIR, `${req.params.taskId}.log.jsonl`);
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
