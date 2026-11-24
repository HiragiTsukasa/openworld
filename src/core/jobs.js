// MUGEN CITY — time-sliced job scheduler (G.jobs, ARCHITECTURE §3.5).
//
//   const h = G.jobs.add(function* () { for (...) { work(); yield; } }, { priority: 5, key: 'chunk:3:4' });
//   h.cancel();  h.done;  await h.promise;
//
// Generators should `yield` roughly every 0.5 ms of work. The scheduler steps the highest
// priority job until the frame budget is used up (FIFO among equal priorities).

import { registerSystem, reportError } from './game.js';
import { CONFIG } from './config.js';

const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;

class Job {
  constructor(gen, priority, key, seqNo) {
    this.gen = gen;
    this.priority = priority;
    this.key = key;
    this.seq = seqNo;
    /** true once the generator finished (or failed / was cancelled) */
    this.done = false;
    this.cancelled = false;
    this.error = null;
    this.running = false;
    this._promise = null;
    this._resolve = null;
  }

  /**
   * cancel() — stops the job; its generator's `finally` blocks run. Safe to call repeatedly.
   */
  cancel() {
    if (this.done) return;
    this.cancelled = true;
    this.done = true;
    if (!this.running) {
      try {
        if (this.gen && this.gen.return) this.gen.return();
      } catch (err) {
        reportError(err, 'jobs', 'cancel');
      }
    }
    if (this.key !== undefined && keyed.get(this.key) === this) keyed.delete(this.key);
    if (this._resolve) this._resolve(false);
  }

  /**
   * promise → Promise<boolean> resolved with true when the job completed, false when it was
   * cancelled or threw.
   */
  get promise() {
    if (!this._promise) {
      if (this.done) this._promise = Promise.resolve(!this.cancelled && !this.error);
      else this._promise = new Promise((resolve) => (this._resolve = resolve));
    }
    return this._promise;
  }
}

/** @type {Job[]} sorted by priority desc, then seq asc */
const queue = [];
/** @type {Map<any, Job>} */
const keyed = new Map();
let seqNo = 0;

function finish(job, err) {
  job.done = true;
  job.running = false;
  if (err) job.error = err;
  if (job.key !== undefined && keyed.get(job.key) === job) keyed.delete(job.key);
  if (job._resolve) job._resolve(!err && !job.cancelled);
}

function now() {
  return performance.now();
}

export const jobs = registerSystem({
  name: 'jobs',
  order: 1,
  runWhenPaused: true,

  /** per-frame budget in ms while not loading */
  budgetMs: CONFIG.JOBS_BUDGET_MS,
  /** set true during loading screens to use the larger loading budget */
  loading: false,
  /** statistics of the last run() call */
  stats: { steps: 0, ms: 0, completed: 0 },

  /**
   * add(generatorFn | generator | fn, {priority=0, key}) → handle {cancel(), done, promise, key}.
   * Higher priority runs first. A new job with the same `key` cancels the pending one.
   * Plain functions are accepted and run as a single step.
   * @param {Function|Generator} work
   * @param {{priority?: number, key?: any}} [opts]
   * @returns {Job}
   */
  add(work, opts) {
    const priority = opts && typeof opts.priority === 'number' ? opts.priority : 0;
    const key = opts ? opts.key : undefined;
    let gen;
    if (typeof work === 'function') {
      if (work instanceof GeneratorFunction) gen = work();
      else
        gen = (function* () {
          work();
        })();
    } else {
      gen = work;
    }
    const job = new Job(gen, priority, key, seqNo++);
    if (!gen || typeof gen.next !== 'function') {
      reportError(new Error('jobs.add: expected a generator or function'), 'jobs', 'add');
      finish(job, new Error('invalid job'));
      return job;
    }
    if (key !== undefined) {
      const prev = keyed.get(key);
      if (prev) prev.cancel();
      keyed.set(key, job);
    }
    // sorted insert (priority desc, FIFO within a priority)
    let at = queue.length;
    while (at > 0 && queue[at - 1].priority < priority) at--;
    queue.splice(at, 0, job);
    return job;
  },

  /**
   * cancel(key) → true when a pending job with that key was cancelled.
   * @param {any} key
   * @returns {boolean}
   */
  cancel(key) {
    const job = keyed.get(key);
    if (!job) return false;
    job.cancel();
    return true;
  },

  /**
   * has(key) → true while a job with that key is pending.
   * @param {any} key
   * @returns {boolean}
   */
  has(key) {
    return keyed.has(key);
  },

  /** pending → number of unfinished jobs in the queue. */
  get pending() {
    let n = 0;
    for (let i = 0; i < queue.length; i++) if (!queue[i].done) n++;
    return n;
  },

  /**
   * run(budgetMs) → number of jobs still pending. Steps jobs until the budget is exhausted
   * (always performs at least one step when work is pending). Called once per frame by the core.
   * @param {number} budgetMs
   * @returns {number}
   */
  run(budgetMs) {
    const stats = this.stats;
    stats.steps = 0;
    stats.completed = 0;
    if (queue.length === 0) {
      stats.ms = 0;
      return 0;
    }
    const t0 = now();
    const deadline = t0 + (budgetMs > 0 ? budgetMs : 0);
    let i = 0;
    while (i < queue.length) {
      const job = queue[i];
      if (job.done) {
        queue.splice(i, 1);
        continue;
      }
      if (job.running) {
        // re-entrant run()/flush() from inside this job: leave it alone, work on the others
        i++;
        continue;
      }
      job.running = true;
      let res = null;
      let failed = null;
      try {
        res = job.gen.next();
      } catch (err) {
        failed = err;
      }
      job.running = false;
      stats.steps++;
      if (failed) {
        reportError(failed, 'jobs', job.key !== undefined ? String(job.key) : 'job');
        finish(job, failed);
        stats.completed++;
      } else if (job.cancelled) {
        // cancelled from inside its own step
        try {
          if (job.gen.return) job.gen.return();
        } catch (err) {
          reportError(err, 'jobs', 'cancel');
        }
      } else if (res.done) {
        finish(job, null);
        stats.completed++;
      }
      // a step may have queued a higher-priority job: always restart from the front
      i = 0;
      if (now() >= deadline) break;
    }
    // drop finished jobs left at the front
    while (queue.length > 0 && queue[0].done) queue.shift();
    stats.ms = now() - t0;
    return queue.length;
  },

  /**
   * flush(maxMs=Infinity) → number of jobs still pending (0 = everything finished).
   * Runs all queued jobs synchronously (loading screens, teleports, tests).
   * @param {number} [maxMs]
   * @returns {number}
   */
  flush(maxMs = Infinity) {
    const t0 = now();
    let guard = 0;
    for (;;) {
      let runnable = false;
      for (let i = 0; i < queue.length; i++) {
        if (!queue[i].done && !queue[i].running) {
          runnable = true;
          break;
        }
      }
      if (!runnable) break;
      const left = maxMs - (now() - t0);
      if (left <= 0) break;
      this.run(Math.min(left, 50));
      if (++guard > 1e7) break;
    }
    return this.pending;
  },

  /**
   * clear() — cancels every pending job.
   */
  clear() {
    for (let i = queue.length - 1; i >= 0; i--) queue[i].cancel();
    queue.length = 0;
    keyed.clear();
  },
});

export default jobs;
