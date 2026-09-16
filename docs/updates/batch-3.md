# 批次 3 更新：多專案的排程規則

批次 3（#11–#16）已完成，版本更新為 `0.3.0`。

## 已完成

- Project 支援分鐘、小時與平均工作日的 Effort Estimate；可查看已花與剩餘工作量。
- Schedule Weight 加入截止日緊迫度、Requester 權重與手動優先級，並依設定比例產生總分。
- 依截止日、可用時間與安全緩衝計算 Must-Start-By；逾期 Project 先取得每日保底份額。
- 計算 Deadline Risk Warning，顯示預估完成日、可用分鐘、剩餘分鐘與觸發條件；支援 Project 個別門檻。
- 依完整專注循環產生建議 Time Block；Commitment、鎖定時段與零碎空檔會從分配中排除。
- 側邊欄與 popup 顯示建議、權重、Must-Start-By、預警與鎖定狀態；每個進行中 Project 都會顯示剩餘／可用分鐘與預估完成日。
- 支援從建議或空檔鎖定、移動與取消鎖定 Time Block；鎖定／移動保存只含四個排程欄位的 `lockedTimeBlock` Override 快照。
- 儲存 schemaVersion 升至 3，新增按月分檔的 `time-blocks/YYYY-MM`。

## 驗證

- TDD 核心測試涵蓋 Effort Estimate、權重、保底、預警、建議分配與 Time Block 鎖定流程。
- `npm test`、`npm run typecheck` 與 `npm run build` 均通過。
