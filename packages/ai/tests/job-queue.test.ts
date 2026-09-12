import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobQueue, type JobHandler } from "../src/job-queue.js";

function createMockDB() {
  const db = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => {
      return Promise.resolve([{ id: `job-${Date.now()}` }]);
    }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      return Promise.resolve([]);
    }),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockImplementation(() => {
      return Promise.resolve([]);
    }),
  };

  return db;
}

describe("JobQueue", () => {
  let queue: JobQueue;
  let mockDb: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    mockDb = createMockDB();
    queue = new JobQueue(mockDb as never, 1000);
  });

  afterEach(() => {
    queue.stop();
  });

  it("enqueue inserts a job and returns job ID", async () => {
    const jobId = await queue.enqueue("test-job", { data: "hello" });
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });

  it("enqueue with custom options", async () => {
    const jobId = await queue.enqueue("test-job", { data: "hello" }, {
      priority: "P1",
      maxAttempts: 5,
      runAfter: new Date("2025-01-01"),
    });
    expect(typeof jobId).toBe("string");
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "test-job",
        priority: "P1",
        maxAttempts: 5,
      }),
    );
  });

  it("on registers handler", () => {
    const handler = vi.fn();
    queue.on("test-job", handler);
    expect(queue["handlers"].has("test-job")).toBe(true);
    expect(queue["handlers"].get("test-job")).toBe(handler);
  });

  it("start/stop manages poll timer", () => {
    expect(queue["pollTimer"]).toBeNull();
    queue.start();
    expect(queue["pollTimer"]).not.toBeNull();
    queue.stop();
    expect(queue["pollTimer"]).toBeNull();
  });

  it("stats queries grouped by status", async () => {
    mockDb.groupBy.mockResolvedValue([
      { status: "QUEUED", count: 5 },
      { status: "RUNNING", count: 2 },
    ]);

    const stats = await queue.stats();
    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.from).toHaveBeenCalled();
    expect(mockDb.groupBy).toHaveBeenCalled();
    expect(typeof stats.queued).toBe("number");
    expect(typeof stats.running).toBe("number");
    expect(typeof stats.completed).toBe("number");
    expect(typeof stats.failed).toBe("number");
  });
});
