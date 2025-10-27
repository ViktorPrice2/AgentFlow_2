const queue = [];

export class QueueService {
  static addJob(agentType, payload) {
    const job = { agentType, payload };
    queue.push(job);
    return job;
  }

  static getJob() {
    return queue.shift();
  }

  static isQueueEmpty() {
    return queue.length === 0;
  }

  static clear() {
    queue.length = 0;
  }
}
