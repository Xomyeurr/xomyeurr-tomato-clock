import { type CommandResult, fail, succeed } from './result';
import { SELF_REQUESTER_ID } from './state';
import type { AppState, Context, Timestamp } from './types';
import { isWeight } from './validation';

export type RequesterCommand =
  | { type: 'createRequester'; name: string; defaultWeight: number }
  | { type: 'updateRequester'; requesterId: string; name?: string; defaultWeight?: number }
  | { type: 'archiveRequester'; requesterId: string }
  | { type: 'deleteRequester'; requesterId: string };

const invalidName = () => fail('invalid_name', '請輸入 Requester 名稱');
const invalidWeight = () => fail('invalid_weight', '權重必須是 1 到 5 的整數');

export function applyRequesterCommand(
  state: AppState,
  command: RequesterCommand,
  ctx: Context,
  ts: Timestamp,
): CommandResult {
  switch (command.type) {
    case 'createRequester': {
      const name = command.name.trim();
      if (!name) return invalidName();
      if (!isWeight(command.defaultWeight)) return invalidWeight();
      return succeed({
        ...state,
        requesters: [
          ...state.requesters,
          { id: ctx.newId('req'), name, defaultWeight: command.defaultWeight, status: 'active', createdAt: ts, updatedAt: ts },
        ],
      });
    }

    case 'updateRequester': {
      const requester = state.requesters.find((r) => r.id === command.requesterId);
      if (!requester) return fail('requester_not_found', '找不到這個 Requester');
      const name = command.name !== undefined ? command.name.trim() : requester.name;
      if (!name) return invalidName();
      const defaultWeight = command.defaultWeight ?? requester.defaultWeight;
      if (!isWeight(defaultWeight)) return invalidWeight();
      return succeed({
        ...state,
        requesters: state.requesters.map((r) =>
          r.id === requester.id ? { ...r, name, defaultWeight, updatedAt: ts } : r,
        ),
      });
    }

    case 'archiveRequester': {
      const requester = state.requesters.find((r) => r.id === command.requesterId);
      if (!requester) return fail('requester_not_found', '找不到這個 Requester');
      if (requester.id === SELF_REQUESTER_ID) return fail('cannot_archive_self_requester', '內建的「自己」不能封存');
      return succeed({
        ...state,
        requesters: state.requesters.map((r) => r.id === requester.id ? { ...r, status: 'archived', updatedAt: ts } : r),
      });
    }

    case 'deleteRequester': {
      const requester = state.requesters.find((r) => r.id === command.requesterId);
      if (!requester) return fail('requester_not_found', '找不到這個 Requester');
      if (requester.id === SELF_REQUESTER_ID) return fail('cannot_delete_self_requester', '內建的「自己」不能刪除');
      const projectIds = state.projects.filter((p) => p.requesterId === requester.id).map((p) => p.id);
      const taskIds = new Set(state.tasks.filter((t) => projectIds.includes(t.projectId)).map((t) => t.id));
      if (state.sessions.some((s) => taskIds.has(s.taskId))) {
        return fail('requester_has_history', '這個 Requester 已有工作紀錄,只能封存');
      }
      if (state.projects.some((p) => p.requesterId === requester.id)) {
        return fail('requester_in_use', '這個 Requester 仍被 Project 使用');
      }
      return succeed({ ...state, requesters: state.requesters.filter((r) => r.id !== requester.id) });
    }
  }
}
