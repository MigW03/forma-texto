import { describe, it, expect, vi } from 'vitest'
import { JobQueue } from './jobQueue'

/** A promise plus its resolver, so a test can control exactly when a job finishes. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('JobQueue', () => {
  it('runs up to maxConcurrent jobs immediately, queues the rest', async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>()
    const started: string[] = []
    const queue = new JobQueue(
      {
        async process(id) {
          started.push(id)
          const gate = deferred()
          gates.set(id, gate)
          await gate.promise
        },
      },
      2,
    )

    queue.enqueue('a')
    queue.enqueue('b')
    queue.enqueue('c')
    await Promise.resolve() // let synchronous .process() bodies run
    await Promise.resolve()

    expect(started).toEqual(['a', 'b']) // c held back — only 2 slots
    expect(queue.running).toBe(2)
    expect(queue.pending).toBe(1)

    gates.get('a')!.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(started).toEqual(['a', 'b', 'c']) // a's slot freed, c started
    expect(queue.pending).toBe(0)

    gates.get('b')!.resolve()
    gates.get('c')!.resolve()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(queue.running).toBe(0)
  })

  it('a job throwing does not block the rest of the queue', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const processed: string[] = []
    const queue = new JobQueue(
      {
        async process(id) {
          if (id === 'bad') throw new Error('boom')
          processed.push(id)
        },
      },
      1,
    )

    queue.enqueue('bad')
    queue.enqueue('good')
    // Flush the microtask queue enough times for both sequential jobs to settle.
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(processed).toEqual(['good'])
    expect(queue.running).toBe(0)
    expect(queue.pending).toBe(0)
    errSpy.mockRestore()
  })

  it('defaults to MAX_CONCURRENT when no limit is given', () => {
    const queue = new JobQueue({ process: async () => {} })
    expect(queue.running).toBe(0)
    expect(queue.pending).toBe(0)
  })
})
