import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';

export type QueueProcessor<T = any> = (
  payload: T,
  updateProgress: (pct: number) => Promise<void>,
) => Promise<void>;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly bullQueues = new Map<string, Queue>();
  private readonly bullWorkers = new Map<string, Worker>();
  private readonly localProcessors = new Map<string, QueueProcessor>();
  private useBullMq = false;

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && redisUrl !== 'embedded') {
      this.useBullMq = true;
      this.logger.log('QueueService configured for distributed BullMQ + Redis workers');
    } else {
      this.useBullMq = false;
      this.logger.log('QueueService running embedded async background worker pool');
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const worker of this.bullWorkers.values()) {
      await worker.close().catch(() => undefined);
    }
    for (const queue of this.bullQueues.values()) {
      await queue.close().catch(() => undefined);
    }
  }

  registerWorker<T = any>(queueName: string, processor: QueueProcessor<T>, concurrency = 4): void {
    this.localProcessors.set(queueName, processor);

    if (this.useBullMq && process.env.REDIS_URL) {
      const url = new URL(process.env.REDIS_URL);
      const connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
      };
      const queue = new Queue(queueName, { connection });
      const worker = new Worker(
        queueName,
        async (job: Job<T>) => {
          await processor(job.data, async (pct: number) => {
            await job.updateProgress(pct);
          });
        },
        { connection, concurrency },
      );
      worker.on('failed', (job, err) => {
        this.logger.error(`BullMQ job ${job?.id} in ${queueName} failed: ${err.message}`);
      });
      this.bullQueues.set(queueName, queue);
      this.bullWorkers.set(queueName, worker);
    }
  }

  async enqueue<T = any>(queueName: string, jobName: string, payload: T): Promise<string> {
    if (this.useBullMq && this.bullQueues.has(queueName)) {
      const job = await this.bullQueues.get(queueName)!.add(jobName, payload, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 1500 },
        removeOnComplete: 500,
        removeOnFail: 500,
      });
      return String(job.id);
    }

    const localJobId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const processor = this.localProcessors.get(queueName);
    if (processor) {
      setImmediate(() => {
        processor(payload, async () => undefined).catch((err) => {
          this.logger.error(`Background worker [${queueName}/${jobName}] error: ${err?.message}`);
        });
      });
    }
    return localJobId;
  }
}
