import { type CommandResult, fail, succeed } from './result';
import type { AppState, Context, Timestamp } from './types';
import { isWeight } from './validation';

export type RequesterCommand =
  | { type: 'createRequester'; name: string; defaultWeight: number }
  | { type: 'updateRequester'; requesterId: string; name?: string; defaultWeight?: number };

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
  }
}
