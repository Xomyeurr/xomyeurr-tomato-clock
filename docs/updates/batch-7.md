# 批次 7 更新：關閉剩餘 issue 與 Phase 1 逐條稽核

批次 7 收掉 GitHub 上剩下的 issue(#20、#22–#26),並把 #1 的 85 條 user story 逐條稽核完。

## 已完成

- 批次 5 的 UI 決定(#20、#22–#26)原本只有人工驗證,現在改用測試守住。專案加入 jsdom 後，`tests/extension/` 可以直接檢查 view function 和進入點產生的 DOM。
- 稽核 #1 時發現 story 76 沒有實作:多個已過 Must-Start-By 的 Project 搶同一份每日保底時間時，分不到的那個原本完全沒有訊號。`getDeadlineRiskWarning` 新增 `guarantee_not_met` 條件補上。
- #26(popup 固定住)確認是 Chrome 平台限制，popup 內部無法阻止失焦關閉。決定維持「需要固定開著就用側邊欄」，不另開獨立分頁。

## 新增的測試覆蓋

| 檔案 | 守住的行為 |
|---|---|
| `tests/extension/daily-ui.test.ts` | 專案排程與摘要的主題區塊、每個建議時段自帶鎖定按鈕、沒有下拉選單、建議時段文字精簡、鎖定列可就地移動與取消、摘要隨時鐘重算、用完 Effort Estimate 會持續提醒重新估計 |
| `tests/extension/entry-points.test.ts` | 側邊欄的設定入口、側邊欄區塊順序(摘要→時間軸→專案排程)、popup 開著時持續刷新剩餘時間、popup 底部改開側邊欄 |
| `tests/extension/static-assets.test.ts` | popup 隱藏捲軸但沒有關掉捲動 |
| `tests/core/batch-3-domain.test.ts` | 保底衝突時分不到的 Project 會出預警 |

## 注意

`tsconfig.json` 的 `types` 加入 `node`,讓測試能讀靜態檔案。`tsconfig.core.json` 仍然是 `types: []`,加上 `scripts/check-core-purity.mjs`,核心不依賴 Chrome API、系統時鐘和亂數 id 的保證沒有變。

## 驗證

- `npm test`(140 passed / 19 files)
- `npm run typecheck`(含 core purity check)
- `npm run build`
