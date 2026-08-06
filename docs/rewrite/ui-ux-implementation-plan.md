# 新小幫手系統 UI/UX 實作規劃報告

Last updated: 2026-07-30

## 目的

本報告記錄新小幫手系統的 UI 優化方向與實作批次。規劃分別涵蓋小幫手畫面與管理員畫面，但以既有功能為基礎，不重新設計商業流程。

本階段的原則是「UI 優先、UX 低風險」：保留既有導覽、任務順序、權限、API、資料結構與 staging → admin review → explicit merge 邊界，只改善視覺層級、元件一致性、響應式版面與操作狀態呈現。

## 整體視覺方向

- 乾淨、安靜、工具優先；以清楚的資訊階層與高信心主要操作為核心。
- 小幫手畫面以手機現場操作為優先，突出目前行程、下一步、上傳／送出狀態與可重試錯誤。
- 管理員畫面以桌面作業掃描為優先，突出待處理事項、即時回傳、結帳、補買與審核合併。
- 使用深墨綠作為小幫手主要色、暖珊瑚色作為管理員辨識色，搭配米白背景、低對比邊框與有限陰影。
- 使用繁中字體為主要 UI 字體，標題採較有辨識度但仍易讀的 display 字體；金額、數量與狀態識別使用固定寬度數字樣式。
- 以「現在／下一步／已完成」作為工作狀態的視覺語言，協助使用者快速判讀進度；不改變既有流程。

## UI 批次順序

1. 登入、Session Bar、全域導覽、共用狀態呈現。
2. 管理員行程／小幫手管理與小幫手首頁、行程清單。
3. 小幫手進行中行程工作區、概覽與結束行程阻擋狀態。
4. 小幫手現場照片與管理員即時照片回傳。
5. 詢價／細圖發布、回覆與管理員審閱。
6. 採買、快速發布、部分採買、取消、缺貨與找不到。
7. 挑臉審核、最終確認、staging 預覽與行程結束 gate。
8. 結帳預檢、管理員付款審核與集運倉證明。
9. 私人／公開補買、認領、釋出、回報與 checkout。
10. 管理員總覽與多行程即時協調。
11. staging review 與 explicit merge。
12. 跨系統 loading、empty、error、retry、responsive、accessibility 與前端讀取／媒體載入檢查。

每批都要從 helper mobile 與 admin desktop 的實際使用情境檢視畫面，並同步檢查是否有不必要的整頁刷新、過寬讀取、過早 signed URL、eager media 或過度 revalidation。效能修正不得繞過權限、冪等、版本檢查、R2 durable `storage_key` 或 staging/main 邊界。

## Batch 1 實作範圍

Batch 1 僅處理共用 UI，不新增商業功能：

- 登入畫面的文案、表單層級、錯誤語意、loading 與手機 tap target。
- Session Bar 的角色辨識、登入帳號、登出 pending 狀態與 responsive 版面。
- Helper／Admin 共用 WorkspaceNav、選取狀態、角色色彩、鍵盤 focus、`aria-current` 與手機水平導覽。
- 共用 StatusBadge、InsightBanner、EmptyState、RetryableError 與 Server Action pending／retry 呈現。
- 保留一個共同登入入口，由帳號權限決定進入小幫手或管理工作台；不新增角色選擇流程。

目前 Batch 1 已有第一輪本地實作，本次收尾只做低風險 UI 調整與驗證。現有功能中的 issue report placeholder 不在本批次擴充。

## 驗收

- `npm test`、`npm run build`、`git diff --check` 通過。
- 未登入進入 `/helper`、`/admin` 時能看到正確登入導向。
- 登入頁在 390px 寬度無水平溢出，主要按鈕與返回控制至少 44px。
- Helper 與 Admin 的 Session Bar 角色辨識清楚，手機與桌面均可判讀。
- 導覽具有正確 `aria-label`、`aria-current`、鍵盤 focus 與 selected state。
- 登出 pending、登入失敗、一般 retryable error 不會遺失目前工作上下文。
- `prefers-reduced-motion` 仍被尊重。
- 不修改既有 API、資料庫、權限、任務狀態或 staging/main 資料邊界。

## 尚未納入本報告的內容

- issue report 完整工作流程。
- 生產環境硬化、真實 Supabase／R2／Vercel acceptance 與完整 dress rehearsal。
- 大型 read model、分頁、signed URL 快取或跨區域效能重構；這些只在各批次 UI 需要時提出並明確列為後續工作。
