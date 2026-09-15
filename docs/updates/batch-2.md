# 批次 2 更新：一天的時間

批次 2（#6–#10）已完成，版本更新為 `0.2.0`。

## 已完成

- 每週工時範本、多段時段、單日調整與休假；popup 可用 `+`／`−` 調整最後下班時間。
- 單次與每週重複 Commitment，可連結 Project、修改及取消單次展開。
- 今日統計：規劃內工作、臨時工作、已用行程與剩餘可用時間。工作與行程重疊時不重複扣除。
- Free Timer 支援自訂到期提示與無長度碼錶；到 150 分鐘或當日最後下班時間會自動停止並要求確認結束時間。
- 事後補登既有 Task 或現場建立 Ad-hoc Task，重疊的 Work Session 會拒絕。
- popup 與側邊欄支援插入臨時工作；正在進行的工作會記為 `interrupted`，並保存中斷關聯。
- 側邊欄顯示依時間排序的工時、Commitment、Work Session、備註、結果樣式與即時統計。
- `chrome.storage.local` schemaVersion 升至 2，加入 `work-hours` 與 `commitments`，舊資料首次載入會自動補齊；跨頁面寫入使用 Web Lock。

## 驗證

- `npm test`：9 個測試檔、78 個測試全部通過。
- `npm run typecheck`：TypeScript、核心純度檢查全部通過。
- `npm run build`：Manifest V3 擴充套件成功打包。
- Chromium smoke test 已準備完成，但目前執行環境缺少 `libatk`、`libgbm` 等系統共享庫，無法啟動 headless Chromium；不影響上述自動化驗證。

## 資料與使用方式

請先執行 `npm run build`，再到 `chrome://extensions` 重新載入 `dist`。工時與 Commitment 在選項頁設定；popup 用於啟動 Pomodoro、碼錶、插入臨時工作、補登與查看今日統計；側邊欄用於查看完整時間軸與補登。
