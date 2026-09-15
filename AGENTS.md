# AGENTS.md

單人使用的時間管理 Chrome 擴充套件(Manifest V3):專案規劃,加上番茄鐘、碼錶、事後補登、固定行程和時段規劃。設計已定案,還沒有程式碼。

## 開始工作前

- 產品範圍、使用情境、開發階段、尚未決定的事:讀 [README.md](./README.md)
- 命名變數、型別、檔案,或討論領域概念:使用 [CONTEXT.md](./CONTEXT.md) 的術語
- 定義或修改資料欄位、`chrome.storage.local` 的鍵名、`./data` 的檔案格式:先讀 [docs/data-model.md](./docs/data-model.md)
- 修改儲存方式、AI 觸發或寫入機制,或擴充套件和外部程式的分工:先讀 [docs/adr/](./docs/adr/)
- 遇到 README「還沒決定的事」:先問使用者,不要自己決定

## 目前階段:Phase 1

只實作 README「開發階段」表格裡 Phase 1 的內容。Phase 2、3 的功能先不做,但資料結構要讓之後的 AI 和 Companion Process 讀得懂。

## 必須遵守的規則

- 排程引擎是純規則計算,寫成可以測試的函式。AI 只負責檢視規則,不參與排程計算。
- 建議時段和「下一個 Task」都依當下狀態即時計算,不儲存;只有使用者鎖定的 Time Block 會存下來。
- 在鎖定的 Time Block 內,下一個 Task 只從該時段的 Project 挑選。
- 每個 Work Session 只屬於一個 Task。事後補登和 Ad-hoc Task 同樣遵守這條規則。
- Project 和 Task 都只能由使用者手動標記完成。
- Interrupt Bucket 的時間要算進當天已用時間,但統計時要和規劃內的工作分開。
- Commitment 的時間要從當天可用時間扣掉,但永遠不扣 Effort Estimate 的剩餘量。
- 已過 Must-Start-By 的 Project 先拿保底份額,剩下的可用時間才依 Schedule Weight 分配。
- Deadline Risk Warning 只在介面上顯示給使用者看。
- 使用者沒照建議做(改做別的 Task、鎖定時段)時,寫入一筆 Override。
- `chrome.storage.local` 是主要資料來源,只有擴充套件能修改資料;`./data` 的 JSON 是單向匯出、給 AI 讀的副本,AI 的修改只能透過 Proposal。
- File System Access API 只在 options 頁面、由使用者點擊後呼叫。

## 維護文件

- 出現新術語,或既有術語的意思改變:立即更新 CONTEXT.md
- 資料欄位、檔案格式改變:更新 docs/data-model.md,並提高 `schemaVersion`
- 做出難以回頭、有取捨,而且沒有背景說明會讓人看不懂的決定:在 `docs/adr/` 新增一筆 ADR
- 範圍、階段有變動,或「還沒決定的事」有了結論:更新 README.md

## Agent skills

### Issue tracker

Issue 和規格放在 GitHub Issues(`Xomyeurr/xomyeurr-tomato-clock`),用 `gh` 操作。詳見 `docs/agents/issue-tracker.md`。

### Triage labels

使用預設的五個分類標籤:`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。詳見 `docs/agents/triage-labels.md`。

### Domain docs

單一情境:根目錄一份 `CONTEXT.md`,決策紀錄放在 `docs/adr/`。詳見 `docs/agents/domain.md`。
