import { vi } from 'vitest';

export interface RecordedInsertCall {
  table: unknown;
  values: unknown;
  onConflict?: 'nothing' | 'update';
  onConflictTarget?: unknown;
  onConflictSet?: unknown;
  returned: boolean;
}

export interface RecordedUpdateCall {
  table: unknown;
  set: Record<string, unknown>;
  where: unknown;
  returned: boolean;
}

export interface RecordedDeleteCall {
  table: unknown;
  where: unknown;
  returned: boolean;
}

export interface MockDbScript {
  selectResults?: unknown[];
  returningResults?: unknown[][];
  executeResults?: unknown[];
  selectHandler?: (context: { table: unknown; where: unknown; limit?: number }) => unknown;
  insertError?: Error | ((call: RecordedInsertCall) => Error | undefined);
  updateError?: Error | ((call: RecordedUpdateCall) => Error | undefined);
  deleteError?: Error | ((call: RecordedDeleteCall) => Error | undefined);
  executeError?: Error | ((sqlText: string) => Error | undefined);
}

export interface MockDbState {
  selectCalls: Array<{
    table: unknown;
    where: unknown;
    limit?: number;
    offset?: number;
    lock?: string;
  }>;
  insertCalls: RecordedInsertCall[];
  updateCalls: RecordedUpdateCall[];
  deleteCalls: RecordedDeleteCall[];
  executeCalls: string[];
  transactionCount: number;
  committedTransactions: number;
  rolledBackTransactions: number;
}

/** Extract readable SQL text from a Drizzle SQL / sql.raw object for test assertions. */
export function extractSqlText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (!node || typeof node !== 'object') return '';
  if ('value' in node && Array.isArray((node as { value?: unknown }).value)) {
    return (node as { value: unknown[] }).value.map(extractSqlText).join('');
  }
  if ('queryChunks' in node && Array.isArray((node as { queryChunks?: unknown }).queryChunks)) {
    return (node as { queryChunks: unknown[] }).queryChunks.map(extractSqlText).join('');
  }
  if ('name' in node && typeof (node as { name?: unknown }).name === 'string') {
    return (node as { name: string }).name;
  }
  return '';
}

/** Create a PostgreSQL unique_violation (`23505`) error wrapped optionally via `cause`. */
export function pgUniqueViolationError(
  message = 'duplicate key value violates unique constraint'
): Error & {
  code: string;
  cause: { code: string };
} {
  const err = new Error(message) as Error & { code: string; cause: { code: string } };
  err.code = '23505';
  err.cause = { code: '23505' };
  return err;
}

/**
 * Reusable chainable Drizzle DB mock for domain unit tests.
 * Supports arbitrary chain termination, transaction commit/rollback counters,
 * `.for('update')`, `.onConflictDoNothing()`, `.onConflictDoUpdate()`, `.returning()`,
 * `.execute()`, and error injection without brittle private-method spying.
 */
export function createMockDb(script: MockDbScript = {}) {
  const selectQueue = [...(script.selectResults ?? [])];
  const returningQueue = [...(script.returningResults ?? [])];
  const executeQueue = [...(script.executeResults ?? [])];

  const state: MockDbState = {
    selectCalls: [],
    insertCalls: [],
    updateCalls: [],
    deleteCalls: [],
    executeCalls: [],
    transactionCount: 0,
    committedTransactions: 0,
    rolledBackTransactions: 0,
  };

  function resolveMaybeError<T>(
    errSpec: Error | ((arg: T) => Error | undefined) | undefined,
    arg: T
  ): Error | undefined {
    if (!errSpec) return undefined;
    return typeof errSpec === 'function' ? errSpec(arg) : errSpec;
  }

  function makeSelectChain() {
    let table: unknown;
    let where: unknown;
    let limitVal: number | undefined;
    let offsetVal: number | undefined;
    let lockMode: string | undefined;
    let settledPromise: Promise<unknown> | null = null;

    const executeSelect = (): Promise<unknown> => {
      if (!settledPromise) {
        state.selectCalls.push({
          table,
          where,
          limit: limitVal,
          offset: offsetVal,
          lock: lockMode,
        });
        if (script.selectHandler) {
          settledPromise = Promise.resolve(script.selectHandler({ table, where, limit: limitVal }));
        } else {
          const next = selectQueue.length > 0 ? selectQueue.shift() : [];
          settledPromise = next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        }
      }
      return settledPromise;
    };

    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      where(w: unknown) {
        where = w;
        return chain;
      },
      innerJoin() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      groupBy() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit(n: number) {
        limitVal = n;
        return chain;
      },
      offset(n: number) {
        offsetVal = n;
        return chain;
      },
      for(mode: string) {
        lockMode = mode;
        return chain;
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        return executeSelect().then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  function makeInsertChain(table: unknown) {
    const call: RecordedInsertCall = { table, values: undefined, returned: false };
    let settledPromise: Promise<unknown> | null = null;

    const executeInsert = (): Promise<unknown> => {
      if (!settledPromise) {
        state.insertCalls.push(call);
        const err = resolveMaybeError(script.insertError, call);
        if (err) {
          settledPromise = Promise.reject(err);
        } else if (call.returned) {
          const next = returningQueue.length > 0 ? returningQueue.shift() : [];
          settledPromise = next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        } else {
          settledPromise = Promise.resolve(undefined);
        }
      }
      return settledPromise;
    };

    const chain: Record<string, unknown> = {
      values(vals: unknown) {
        call.values = vals;
        return chain;
      },
      onConflictDoNothing() {
        call.onConflict = 'nothing';
        return chain;
      },
      onConflictDoUpdate(opts?: { target?: unknown; set?: unknown }) {
        call.onConflict = 'update';
        call.onConflictTarget = opts?.target;
        call.onConflictSet = opts?.set;
        return chain;
      },
      returning() {
        call.returned = true;
        return chain;
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        return executeInsert().then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  function makeUpdateChain(table: unknown) {
    const call: RecordedUpdateCall = { table, set: {}, where: undefined, returned: false };
    let settledPromise: Promise<unknown> | null = null;

    const executeUpdate = (): Promise<unknown> => {
      if (!settledPromise) {
        state.updateCalls.push(call);
        const err = resolveMaybeError(script.updateError, call);
        if (err) {
          settledPromise = Promise.reject(err);
        } else if (call.returned) {
          const next = returningQueue.length > 0 ? returningQueue.shift() : [];
          settledPromise = next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        } else {
          settledPromise = Promise.resolve(undefined);
        }
      }
      return settledPromise;
    };

    const chain: Record<string, unknown> = {
      set(vals: Record<string, unknown>) {
        call.set = vals;
        return chain;
      },
      where(w: unknown) {
        call.where = w;
        return chain;
      },
      returning() {
        call.returned = true;
        return chain;
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        return executeUpdate().then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  function makeDeleteChain(table: unknown) {
    const call: RecordedDeleteCall = { table, where: undefined, returned: false };
    let settledPromise: Promise<unknown> | null = null;

    const executeDelete = (): Promise<unknown> => {
      if (!settledPromise) {
        state.deleteCalls.push(call);
        const err = resolveMaybeError(script.deleteError, call);
        if (err) {
          settledPromise = Promise.reject(err);
        } else if (call.returned) {
          const next = returningQueue.length > 0 ? returningQueue.shift() : [];
          settledPromise = next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        } else {
          settledPromise = Promise.resolve(undefined);
        }
      }
      return settledPromise;
    };

    const chain: Record<string, unknown> = {
      where(w: unknown) {
        call.where = w;
        return chain;
      },
      returning() {
        call.returned = true;
        return chain;
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        return executeDelete().then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn((table: unknown) => makeInsertChain(table)),
    update: vi.fn((table: unknown) => makeUpdateChain(table)),
    delete: vi.fn((table: unknown) => makeDeleteChain(table)),
    execute: vi.fn(async (query: unknown) => {
      const sqlText = extractSqlText(query);
      state.executeCalls.push(sqlText);
      const err = resolveMaybeError(script.executeError, sqlText);
      if (err) throw err;
      return executeQueue.length > 0 ? executeQueue.shift() : { rows: [] };
    }),
    transaction: vi.fn(async (cb: (tx: typeof db) => Promise<unknown>) => {
      state.transactionCount += 1;
      try {
        const res = await cb(db);
        state.committedTransactions += 1;
        return res;
      } catch (err) {
        state.rolledBackTransactions += 1;
        throw err;
      }
    }),
    enqueueSelect(...items: unknown[]) {
      selectQueue.push(...items);
    },
    enqueueReturning(...items: unknown[][]) {
      returningQueue.push(...items);
    },
  };

  return { db, state };
}
