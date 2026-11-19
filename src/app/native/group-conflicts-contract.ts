/** Data-only conflict operations; the native session chooses the account. */
export type GroupConflict = Readonly<{chartId: string; chartName: string; localGroups: readonly string[]; serverGroups: readonly string[]}>;
export type ConflictOperation = Readonly<{operation: 'list'; attemptId: string}> |
  Readonly<{operation: 'resolve'; attemptId: string; conflict: GroupConflict; choice: 'local' | 'server'}>;
export type ConflictResult = Readonly<{kind: 'ok'; conflicts: readonly GroupConflict[]}> |
  Readonly<{kind: 'resolved' | 'stale' | 'write_not_authorized' | 'disabled' | 'unavailable'}>;
export interface ConflictTransport {
  isNative(): boolean;
  invoke(command: 'desktop_group_conflicts_v1', args: {request: Record<string, unknown>}): Promise<unknown>;
}
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNSAFE = /[\p{Cc}\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
function obj(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
}
function prop(o: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o,key);
  if (!d || !d.enumerable || !Object.hasOwn(d,'value')) throw new Error('Invalid conflict response');
  return d.value;
}
function keys(o: object, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(o);
  return actual.length === expected.length && actual.every(k => typeof k === 'string' && expected.includes(k));
}
function text(x: unknown, max: number): x is string {
  return typeof x === 'string' && x.length > 0 && [...x].length <= max && x.trim() === x && !UNSAFE.test(x);
}
function groups(x: unknown): readonly string[] {
  if (!Array.isArray(x) || Object.getPrototypeOf(x) !== Array.prototype || x.length > 50 ||
      Reflect.ownKeys(x).length !== x.length + 1) throw new Error('Invalid groups');
  const out: string[] = [];
  for (let i=0;i<x.length;i++) {
    const value = prop(x,String(i));
    if (!text(value,160) || out.includes(value)) throw new Error('Invalid groups');
    out.push(value);
  }
  return Object.freeze(out);
}
function conflict(x: unknown): GroupConflict {
  if (!obj(x) || !keys(x,['chartId','chartName','localGroups','serverGroups'])) throw new Error('Invalid conflict');
  const chartId=prop(x,'chartId'), chartName=prop(x,'chartName');
  if (typeof chartId !== 'string' || !ID.test(chartId) || typeof chartName !== 'string' ||
      [...chartName].length > 255 || UNSAFE.test(chartName)) throw new Error('Invalid conflict');
  return Object.freeze({chartId,chartName,localGroups:groups(prop(x,'localGroups')),serverGroups:groups(prop(x,'serverGroups'))});
}
export async function requestConflicts(port: ConflictTransport, operation: ConflictOperation): Promise<ConflictResult> {
  try {
    if (!port.isNative() || !ATTEMPT.test(operation.attemptId)) return {kind:'unavailable'};
    let request: Record<string,unknown> = {protocolVersion:1,operation:operation.operation,attemptId:operation.attemptId};
    if (operation.operation === 'resolve') {
      const c=conflict(operation.conflict);
      if (operation.choice !== 'local' && operation.choice !== 'server') return {kind:'unavailable'};
      request={...request,chartId:c.chartId,localGroups:c.localGroups,serverGroups:c.serverGroups,choice:operation.choice};
    } else if (operation.operation !== 'list') return {kind:'unavailable'};
    const raw=await port.invoke('desktop_group_conflicts_v1',{request});
    if (!obj(raw) || prop(raw,'protocolVersion') !== 1) throw new Error('Invalid response');
    const status=prop(raw,'status');
    if (operation.operation === 'list' && status === 'ok' && keys(raw,['protocolVersion','status','conflicts'])) {
      const values=prop(raw,'conflicts');
      if (!Array.isArray(values) || Object.getPrototypeOf(values)!==Array.prototype || values.length>5000 ||
          Reflect.ownKeys(values).length !== values.length+1) throw new Error('Invalid response');
      const result=Array.from({length:values.length},(_,i)=>conflict(prop(values,String(i))));
      if (new Set(result.map(c=>c.chartId)).size !== result.length) throw new Error('Duplicate chart');
      return {kind:'ok',conflicts:Object.freeze(result)};
    }
    if (keys(raw,['protocolVersion','status']) && (status === 'disabled' ||
        (operation.operation === 'resolve' && (status === 'resolved' || status === 'stale' || status === 'write_not_authorized')))) return {kind:status};
  } catch { /* No native errors or account data leave this boundary. */ }
  return {kind:'unavailable'};
}
