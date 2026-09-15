# CLAUDE.md

AI 開發規則統一寫在 AGENTS.md,這裡直接引用,避免兩份文件內容不一致。

@AGENTS.md

## Agent skills

### Issue tracker

Issue 和規格放在 GitHub Issues(`Xomyeurr/xomyeurr-tomato-clock`),用 `gh` 操作。詳見 `docs/agents/issue-tracker.md`。

### Triage labels

使用預設的五個分類標籤:`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。詳見 `docs/agents/triage-labels.md`。

### Domain docs

單一情境:根目錄一份 `CONTEXT.md`,決策紀錄放在 `docs/adr/`。詳見 `docs/agents/domain.md`。
