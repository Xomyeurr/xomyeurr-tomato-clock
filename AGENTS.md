# AGENTS.md

單人使用的番茄鐘時間管理 Chrome 擴充套件(Manifest V3)。設計已定案,還沒有程式碼。

## 開始工作前

- 產品範圍、使用情境、開發階段、尚未決定的事:讀 [README.md](./README.md)
- 命名變數、型別、檔案,或討論領域概念:使用 [CONTEXT.md](./CONTEXT.md) 的術語
- 修改儲存方式、AI 觸發機制,或擴充套件和外部程式的分工:先讀 [docs/adr/](./docs/adr/)
- 遇到 README「還沒決定的事」:先問使用者,不要自己決定

## 目前階段:Phase 1

只實作 README「開發階段」表格裡 Phase 1 的內容。Phase 2、3 的功能先不做,但資料結構要讓之後的 AI 和 Companion Process 讀得懂。

## 必須遵守的規則

- 排程引擎是純規則計算,寫成可以測試的函式。AI 只負責檢視規則,不參與「算下一件事」。
- 每次呼叫排程引擎,都依當下狀態重新算出下一個 Task,不產生固定的整日清單。
- 每個 Pomodoro Session 只屬於一個 Task。Ad-hoc Task 放在 Interrupt Bucket 底下,同樣遵守這條規則。
- Task 只能由使用者手動標記完成。
- Interrupt Bucket 的時間要算進當天產能,但統計時要和規劃內的工作分開。
- 已過 Must-Start-By 的 Project 先拿保底份額,剩下的產能才依 Schedule Weight 分配。
- Deadline Risk Warning 只在介面上顯示給使用者看。
- 系統建議和使用者實際選擇不同時,寫入一筆 Override。
- `chrome.storage.local` 是主要資料來源;`./data` 裡的 JSON 是給 AI 讀寫的同步副本。
- File System Access API 只在 options 頁面、由使用者點擊後呼叫。

## 維護文件

- 出現新術語,或既有術語的意思改變:立即更新 CONTEXT.md
- 做出難以回頭、有取捨,而且沒有背景說明會讓人看不懂的決定:在 `docs/adr/` 新增一筆 ADR
- 範圍、階段有變動,或「還沒決定的事」有了結論:更新 README.md
