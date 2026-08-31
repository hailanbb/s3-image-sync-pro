/**
 * Runs asynchronous tasks strictly in enqueue order.
 *
 * A failed task rejects its own promise but does not poison the queue. The
 * revision is monotonic and is useful when the caller needs to reason about
 * which persisted write happened later.
 */
export class SerializedAsyncQueue {
  private tail: Promise<void> = Promise.resolve();
  private nextRevision = 0;

  enqueue(task: (revision: number) => Promise<void>): Promise<void> {
    const revision = ++this.nextRevision;
    const result = this.tail.then(
      () => task(revision),
      () => task(revision)
    );
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
