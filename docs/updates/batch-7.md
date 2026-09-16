# 批次 7 更新：關閉剩餘 issue 與 Phase 1 逐條稽核

批次 7 收掉 GitHub 上剩下的 issue(#20、#22–#26),並把 #1 的 85 條 user story 逐條稽核完。

## 已完成

- 批次 5 的 UI 決定(#20、#22–#26)原本只有人工驗證,現在改用測試守住。專案加入 jsdom 後，`tests/extension/` 可以直接檢查 view function 和進入點產生的 DOM。
- 稽核 #1 時發現 story 76 沒有實作:多個已過 Must-Start-By 的 Project 搶同一份每日保底時間時，分不到的那個原本完全沒有訊號。`getDeadlineRiskWarning` 新增 `guarantee_not_met` 條件補上。
- #26(popup 固定住)確認是 Chrome 平台限制，popup 內部無法阻止失焦關閉。決定維持「需要固定開著就用側邊欄」，不另開獨立分頁。
- 檢視 `guarantee_not_met` 時修掉兩個誤報:休假日或接近下班、誰都分不到整個番茄鐘的日子不算衝突;沒有未完成 Task 的 Project(story 79 本來就不分配時間)也不算被搶走保底。
- 查出批次 6 留下的一個資料問題:`reconcileLockedTimeBlocks` 會掃過所有 Time Block，所以從過去日期開始的每週 Commitment 會回頭刪掉上週已經鎖定的時段。改成只整理今天以後的鎖定時段，歷史紀錄不動。

## code review 發現並修掉的問題

| 問題 | 影響 |
|---|---|
| `getDeadlineRiskWarning` 是 O(N²) 疊在 367 天迴圈上 | 20 個都已過 Must-Start-By 的 Project 要 2077ms,側邊欄每 30 秒重畫就卡住。以 `AppState` 為鍵的 WeakMap 快取 `dayMinutes` 與 `getSuggestedTimeBlocks` 後降到 50ms |
| 鎖定建議以外的空檔沒有入口 | 批次 3 支援、批次 5 拿掉下方表單時一併弄丟。時間被權重高的 Project 分光或沒有完整空檔可建議時,無法保留時段。改成收在 `details` 裡的次要操作 |
| 固定行程「編輯」沒把 `refresh` 傳下去 | 存檔後編輯表單不會收起來,使用者看不出成功,可能重複送出 |
| 每週工時一次只能展開一列 | 展開第二列會默默丟掉第一列改到一半的內容,「儲存每週工時」也只存展開的那一列 |
| 單日調整預填週範本 | 原封不動送出就把那天釘住,之後改週範本不再套用到那天 |
| Task / Project 刪除沒有確認 | 「刪除」和「封存」在同一個下拉選單裡相鄰,選錯就沒得救;刪除 Project 還會連底下的 Task 一起刪 |

## 新增的測試覆蓋

| 檔案 | 守住的行為 |
|---|---|
| `tests/extension/daily-ui.test.ts` | 專案排程與摘要的主題區塊、每個建議時段自帶鎖定按鈕、沒有下拉選單、建議時段文字精簡、鎖定列可就地移動與取消、摘要隨時鐘重算、用完 Effort Estimate 會持續提醒重新估計 |
| `tests/extension/entry-points.test.ts` | 側邊欄的設定入口、側邊欄區塊順序(摘要→時間軸→專案排程)、popup 開著時持續刷新剩餘時間、popup 底部改開側邊欄 |
| `tests/extension/static-assets.test.ts` | popup 隱藏捲軸但沒有關掉捲動 |
| `tests/core/batch-3-domain.test.ts` | 保底衝突時分不到的 Project 會出預警;休假日和沒有未完成 Task 的 Project 不會誤報 |
| `tests/core/time-blocks.test.ts` | 新增 Commitment 不會改寫過去日期的鎖定時段 |
| `tests/core/planning.test.ts` | 排程查詢的快取會跟著 state 和時鐘變動,不會回舊答案 |
| `tests/extension/options-settings.test.ts` | 每週工時多列一起存、沒展開時停用儲存、單日調整不誤建、固定行程存檔後收起表單、刪除前先確認 |

## 注意

`tsconfig.json` 的 `types` 加入 `node`,讓測試能讀靜態檔案。`tsconfig.core.json` 仍然是 `types: []`,加上 `scripts/check-core-purity.mjs`,核心不依賴 Chrome API、系統時鐘和亂數 id 的保證沒有變。

## 驗證

- `npm test`(151 passed / 20 files)
- `npm run typecheck`(含 core purity check)
- `npm run build`
