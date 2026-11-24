// MUGEN CITY — synchronous event bus (G.events).
// Listener lists are copy-on-write while an emit is in progress, so `on`/`off` from inside a
// listener is always safe and `emit` itself never allocates.

/**
 * Tiny synchronous publish/subscribe bus.
 * Listener errors are isolated (reported through `onError`) and never break the emitter.
 */
export class EventBus {
  /**
   * @param {(err: any, where: string) => void} [onError] called when a listener throws
   */
  constructor(onError) {
    /** @type {Map<string, {fns: Function[], emitting: number}>} */
    this._map = new Map();
    this._onError = onError || null;
  }

  /**
   * on(name, fn) → unsubscribe function. Registers `fn(payload, name)` for `name`.
   * @param {string} name
   * @param {(payload: any, name: string) => void} fn
   * @returns {() => void}
   */
  on(name, fn) {
    if (typeof fn !== 'function') return () => {};
    let rec = this._map.get(name);
    if (!rec) {
      rec = { fns: [], emitting: 0 };
      this._map.set(name, rec);
    } else if (rec.emitting > 0) {
      rec.fns = rec.fns.slice();
    }
    rec.fns.push(fn);
    return () => this.off(name, fn);
  }

  /**
   * once(name, fn) → unsubscribe function. Like `on` but removed after the first call.
   * @param {string} name
   * @param {(payload: any, name: string) => void} fn
   * @returns {() => void}
   */
  once(name, fn) {
    const wrap = (payload, n) => {
      this.off(name, wrap);
      fn(payload, n);
    };
    wrap._orig = fn;
    return this.on(name, wrap);
  }

  /**
   * off(name, fn) — removes a listener (also matches listeners added with `once`).
   * @param {string} name
   * @param {Function} fn
   */
  off(name, fn) {
    const rec = this._map.get(name);
    if (!rec) return;
    let idx = -1;
    for (let i = 0; i < rec.fns.length; i++) {
      if (rec.fns[i] === fn || rec.fns[i]._orig === fn) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    if (rec.emitting > 0) rec.fns = rec.fns.slice();
    rec.fns.splice(idx, 1);
  }

  /**
   * emit(name, payload) → number of listeners called.
   * @param {string} name
   * @param {any} [payload]
   * @returns {number}
   */
  emit(name, payload) {
    const rec = this._map.get(name);
    if (!rec) return 0;
    const fns = rec.fns;
    const n = fns.length;
    if (n === 0) return 0;
    rec.emitting++;
    for (let i = 0; i < n; i++) {
      try {
        fns[i](payload, name);
      } catch (err) {
        if (this._onError) this._onError(err, 'event:' + name);
      }
    }
    rec.emitting--;
    return n;
  }

  /**
   * count(name) → number of listeners registered for `name`.
   * @param {string} name
   * @returns {number}
   */
  count(name) {
    const rec = this._map.get(name);
    return rec ? rec.fns.length : 0;
  }

  /**
   * clear(name?) — removes all listeners of one event, or every listener when omitted.
   * @param {string} [name]
   */
  clear(name) {
    if (name === undefined) this._map.clear();
    else this._map.delete(name);
  }
}
