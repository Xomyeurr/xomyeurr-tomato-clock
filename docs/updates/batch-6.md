# 批次 6 更新：排程衝突整理與 Settings 回歸

批次 6（#28、#29、#30、#33、#35）完成剩餘 ready-for-agent tickets。

## 已完成

- 今日時間軸補齊 Commitment 切開上班時段的邊界情境：中段切開、貼齊開頭或結尾、覆蓋整段、跨多段上班時段都不產生重疊或零長度上班時段。
- 新增或更新 Commitment 後，既有 locked Time Block 會自動扣掉衝突時間；剩餘有效片段保留，完全被覆蓋的 locked Time Block 會移除。
- 今日時間軸、今日摘要剩餘時間、Suggested Time Blocks 與 locked Time Blocks 對 Commitment 扣除邏輯保持一致。
- 固定行程設定改成新增表單加管理清單；既有 Commitment 以摘要列呈現，編輯直接進入單筆表單，取消一次、封存、刪除放在次要操作中，刪除前會確認。
- Settings page 保持掃描優先：每週工時、單日調整、固定行程、Project/Task 區塊在窄版與桌面版都有可換行的控制列，低頻或破壞性操作不再全部攤在第一層。

## 驗證

- `npm test -- tests/core/day.test.ts tests/core/time-blocks.test.ts tests/core/timeline.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
