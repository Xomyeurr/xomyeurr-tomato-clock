# 批次 4 更新：設定、資料匯出與收尾

批次 4（#17–#19）已完成，版本更新為 `0.4.0`。

## 已完成

- 選項頁可編輯全域設定：Pomodoro 專注／休息長度、Free Timer 上限、Schedule Weight 三因子比例、Must-Start-By 安全緩衝與每日保底、Deadline Risk Warning 門檻。
- 核心會驗證設定值；權重比例必須加總為 1，分鐘與門檻不可為不合理值。
- Pomodoro Work Session 會記錄開始當下的專注長度；修改全域設定不會改變正在進行中的 Pomodoro，下一段才套用新設定。
- Requester、Project、Task 和 Commitment 支援封存；Project、Task、Requester 在沒有 Work Session 歷史時可刪除，有歷史時保留資料並要求封存。
- 內建「自己」Requester 不能封存或刪除。
- popup 與側邊欄可把 Ad-hoc Task 升級成正式 Project；舊 Work Session 保持 `adHoc: true`，升級後新的 Work Session 才算規劃內工作。
- 選項頁可透過 File System Access API 連接資料夾，將資料單向匯出到 `./data`，包含目前狀態類 JSON 和按月份分檔的 Work Session、Time Block、Override。
- 資料變動後，已連接資料夾的選項頁會在 30 秒內自動匯出；重開瀏覽器後需要重新連接資料夾。

## 驗證

- 新增核心測試涵蓋全域設定、封存／刪除、Ad-hoc Task 升級與資料匯出格式。
- `npm test`、`npm run typecheck` 與 `npm run build` 均通過。
