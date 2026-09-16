# 批次 3 更新：多專案的排程規則

批次 3（#11–#16）已完成，版本更新為 `0.3.0`。

## 已完成

- Project 支援分鐘、小時與平均工作日的 Effort Estimate；可查看已花與剩餘工作量。
- Schedule Weight 加入截止日緊迫度、Requester 權重與手動優先級，並依設定比例產生總分。
- 依截止日、可用時間與安全緩衝計算 Must-Start-By；逾期 Project 先取得每日保底份額。
- 計算 Deadline Risk Warning，顯示預估完成日、可用分鐘、剩餘分鐘與觸發條件；支援 Project 個別門檻。
- 依完整專注循環產生建議 Time Block；Commitment、鎖定時段與零碎空檔會從分配中排除。
- 側邊欄與 popup 顯示建議、權重、Must-Start-By、預警與鎖定狀態；每個進行中 Project 都會顯示剩餘／可用分鐘與預估完成日。
- 支援從建議或空檔鎖定、拖曳建議到另一個時段、移動與取消鎖定 Time Block；鎖定／移動保存只含四個排程欄位的 `lockedTimeBlock` Override 快照。
- 儲存 schemaVersion 升至 3，新增按月分檔的 `time-blocks/YYYY-MM`。

## 驗證

- TDD 核心測試涵蓋 Effort Estimate、權重、保底、預警、建議分配與 Time Block 鎖定流程。
- 後續補上六項邊界驗證：最大餘數法的權重分配、`moveTimeBlock` 的失敗路徑與自身重疊、鎖定未被建議的空檔時 `suggested` 記為 null、已鎖定時段與當天已做時間各自扣減 Must-Start-By 保底，以及剩餘工作量歸零或超出估時時 deadline urgency 固定為 0。
- extension 的 storage 層另有測試：schemaVersion 1 的資料遷移後保留既有紀錄並補上批次 3 的預設值、鎖定時段依日期分月存入 `time-blocks/YYYY-MM`、載入時再合併回單一陣列、資料版本較新時拒絕載入、指令失敗時完全不寫入。測試只假造 `chrome.storage.local`，`navigator.locks` 使用實際實作，連上鎖路徑一起涵蓋。
- 每一項都以「改壞實作、確認測試轉紅」的方式驗證過；期望值一律依 docs/data-model.md 的規則手算，不從實作反推。
- `npm test`、`npm run typecheck` 與 `npm run build` 均通過。

## 修正

- `moveTimeBlock` 的存在性檢查原本排在 projectId 查詢之後，而該 projectId 正是從這個 Time Block 身上查出來的：Time Block 不存在時會先誤報 `project_not_found`，真正的 `time_block_not_found` 分支永遠不會執行。已把檢查移到查詢之前，與 `unlockTimeBlock` 的行為一致。
