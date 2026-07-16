# 第一次上線前後端check

這份文件記錄新小幫手系統第一次上線前的前後端設計審查結果，作為後續修正、驗證與上線決策的共同參考。

- 建立日期：2026-07-16
- 審查範圍：`minichi_helper_system/` 的 Next.js 前後端、Supabase schema、R2 圖片流程、staging/main boundary、merge、settlement、auth 與測試。
- 狀態標記：`[ ]` 尚未完成；`[~]` 部分完成或待雲端驗證；`[x]` 已有證據完成。
- 分級：強烈建議修改＝第一次上線前應處理；建議＝不一定立即造成錯誤，但應排入近期；建議但不改也不會怎麼樣＝可延後，不是上線阻擋項。

## 1. 本次審查結論

目前的核心資料邊界與主要交易流程設計方向正確，但仍有數個會在重試、並行操作、錯誤恢復、權限隔離或正式雲端環境中造成問題的風險。第一次上線前，應先完成第三節的強烈建議，尤其是檔案上傳、冪等、數量約束、merge 失敗恢復、權限 DTO 與正式部署安全設定。

本次既有驗證證據：

- 使用 workspace bundled Node 執行後端測試：76 tests passed。
- Next.js production build 通過，產生 17 routes。
- `node --check` 通過。
- 本次沒有完成真實 Supabase、R2、Vercel 與瀏覽器多裝置 acceptance；下列雲端與部署項目不能只以本地測試視為完成。

## 2. 已確認的設計優點

- helper 產生的資料先進 staging，經 admin review 與明確 merge 後才進 `main.orders`，邊界方向正確。
- `main.orders` 與 `main.order_source_links` 的責任區分清楚，helper provenance 沒有被當成所有訂單都必須存在的欄位。
- 訂單照片以私有 R2 `storage_key` 作為 durable reference，signed URL 只作暫時呈現，符合資料邊界原則。
- merge 使用 transaction、lock 與 version check 的方向正確，能降低重複 merge 與並行審查覆寫。
- public rebuy 有 atomic claim 的設計，較不容易被多位 helper 同時搶走。
- face-check review gate 已納入流程；未經 admin 核准的 purchase task 不應變成 completed 或 staging order。
- 目前的測試與 build 已能覆蓋主要 route、schema 與基本 workflow，但還不足以覆蓋下列失敗恢復與真實雲端情境。

## 3. 強烈建議修改（第一次上線前處理）

### 3.1 P0：建立 upload intent，綁定檔案用途、操作者與 R2 物件

- 狀態：`[~]` presign 已改為隨機 object id，圖片格式與大小已有部分檢查；upload intent/commit binding 與 R2 `HEAD` 驗證仍需完成。
- 風險：若 metadata API 信任 client 傳入的 `storage_key`，攻擊者或錯誤 client 可能把別人的物件、錯誤用途或未真正上傳的 key 寫入 site photo、quote、purchase 或 rebuy photo。
- 修改：新增 `upload_intents`（intent id、actor、purpose、target、object key、content type、size、expiry、consumed、created by）；metadata commit 只能使用尚未過期且屬於目前操作者與指定用途的 intent，並由 server 對 R2 做 `HEAD` 驗證後才寫 DB。
- 另外處理：intent 過期清理、取消任務時的 orphan object、重複 commit 的明確結果。
- 驗證：同一 key 跨 helper、跨用途、跨 target、過期、未上傳、重複 commit 都必須被拒絕；正常 upload/commit/retry 必須可完成。

### 3.2 P0：補齊 purchase 與 face-check 的冪等契約

- 狀態：`[ ]` 仍需補強並以整合測試證明。
- 風險：目前部分檢查在 idempotency 判斷前執行，網路逾時後 retry 可能因 trip 狀態改變而失敗；同一 idempotency key 若搭配不同 payload，也需要明確拒絕，不能產生不一致結果。
- 修改：建立共用 `idempotency_requests`，至少保存 actor、action、target、payload hash、status、result、created/expired time；同 key 同 payload 回傳原結果，同 key 不同 payload 回傳 conflict。idempotency lookup 應先於會阻擋合法 retry 的狀態檢查，並在同一 transaction 中完成寫入與業務變更。
- 涵蓋：purchase response、face-check approve/reject、必要時 quote/detail、issue report 與 settlement action。
- 驗證：client timeout 後重送、並行雙送、同 key 改 payload、server 在 commit 後回應前斷線，都不得重複扣庫存、重複產單或破壞狀態機。

### 3.3 P0：在 DB 與 service 層強制 quantity invariants

- 狀態：`[ ]` 尚需確認最新 schema 與所有 mutation 已補齊。
- 風險：只限制數值非負不足以防止 `completed_quantity` 或 `unavailable_quantity` 超過原始 `quantity`，可能造成負的剩餘數量、錯誤 settlement 或錯誤 staging order。
- 修改：至少建立並強制 `0 <= completed_quantity <= quantity`、`0 <= unavailable_quantity <= quantity`，並定義二者是否可同時存在；剩餘量由 server 依明確規則計算，不接受 client 自行決定。所有 purchase、unavailable、rebuy 與 admin correction 入口共用同一 validator/transaction。
- 驗證：零數量、超量、並行更新、部分完成後再 unavailable、unavailable 後 rebuy 都要有明確結果與測試。

### 3.4 P0：鎖定 settlement 使用的匯率與金額快照

- 狀態：`[ ]`。
- 風險：exchange rate 可在非 completed 狀態變更，但 total/settlement 可能只在 review 時計算，造成畫面上的金額、儲存的金額與最終結算不一致。
- 修改：決定並落實單一規則：進入 review 或 admin confirmation 時建立 immutable exchange-rate snapshot；若允許修改匯率，必須由 server 重新計算所有衍生金額、記錄版本與 audit event，必要時將 settlement 退回 correction 狀態。金額欄位以整數最小貨幣單位儲存，避免浮點計算。
- 驗證：匯率修改、重複 review、部分訂單、退款/折讓與並行修改都要維持同一份可追溯的金額結果。

### 3.5 P0：把 R2 copy 從不可恢復的 DB transaction 工作改成可恢復 merge

- 狀態：`[ ]`。
- 風險：若在 DB transaction 內直接執行 R2 copy，R2 timeout 會拖長 transaction；DB rollback 也無法回滾已成功的 R2 object，可能產生 orphan object 或 job 卡死。
- 修改：採用可恢復的 merge job/outbox：先寫 merge intent 與 object copy work items，再由 worker 逐項 copy；每個 object 使用 deterministic destination key、狀態、attempt、last error、retry/backoff；全部完成後再以短 transaction 寫入 canonical order/photo references。失敗要能 retry、人工重跑與清理。
- 驗證：copy 中途斷線、部分成功、重跑同一 job、destination 已存在、source 遺失，都不能造成半個成功但 job 顯示 completed。

### 3.6 P0：補上 merge reject 的版本檢查與最終狀態 recheck

- 狀態：`[ ]`。
- 風險：reject 若沒有 `expectedVersion`，可能覆蓋另一個 admin 已完成的 review；merge 執行前若 trip 已結束或 task 已變更，也可能把過時 staging 資料寫入 main。
- 修改：reject 與 approve 都要求 expected version；只允許明確的狀態轉移；merge transaction 內重新檢查 trip、staging order、task 與 photos 的最新狀態，並將 snapshot/version 寫入 merge job。禁止 `approved -> rejected` 等未定義逆向轉移。
- 驗證：兩個 admin 同時 review、review 後 task 被修改、trip 結束後 merge、重送 approve/reject，都必須得到 deterministic 結果。

### 3.7 P0：完成 session refresh 與 production cookie 安全設定

- 狀態：`[~]` 目前進度已記錄改用 server-side `getUser(accessToken)`；仍需驗證 refresh cookie 是否可被正式執行環境持久化。
- 風險：Server Component 取到新 session 但沒有成功寫回 cookie，使用者會在 access token 過期後被反覆登出；production 若未強制 `secure`、正確 `sameSite`、path 與 domain，會造成 token 外洩或跨環境行為不一致。
- 修改：確認 refresh 只在可寫入 cookie 的 server boundary 執行；production 強制 HTTPS、`httpOnly`、`secure`、適當 `sameSite`、短 access token 與可撤銷 refresh session；不要把 service role key 或 refresh token 傳到 client。
- 驗證：access token 過期、頁面 reload、跨 tab、登出撤銷、非 HTTPS 本地環境與 HTTPS production 環境各測一次。

### 3.8 P0：補上 API perimeter：rate limit、body limit、檔案限制與濫用防護

- 狀態：`[~]` 圖片格式/大小已有部分 backend 檢查；rate limit、通用 request body limit、SVG/內容檢查與 production edge 防護仍需完成。
- 風險：登入、presign、commit、purchase response、issue report 等 endpoint 可被暴力呼叫或送入超大 JSON；只看副檔名或 client MIME 也不足以防止惡意檔案與資源耗盡。
- 修改：依 route 設定 body limit、request timeout、rate limit、actor/IP 維度與 audit；限制圖片實際 bytes、格式與像素，預設拒絕 SVG/active content；在 Vercel/WAF 與 R2 CORS/生命周期設定 production policy。
- 驗證：超大 body、超大圖片、錯誤 MIME、過密 retry、未登入、跨 helper key、過期 presign 都要被拒絕且不留下不可控資源。

### 3.9 P0：以 role-specific DTO 隔離 helper 不應看到的欄位

- 狀態：`[ ]` 需逐 route 檢查。
- 風險：共享 query 若直接 select admin review note、`needs_review` 或內部狀態，helper 可能取得不應可見的 admin-only 資訊，即使前端沒有 render 也不算隔離。
- 修改：admin 與 helper 使用分開的 query/DTO/schema；採 allowlist 欄位，不把資料庫 row 直接序列化回傳；在 server action 與 route handler 都驗證 actor role、helper ownership 與 trip scope。
- 驗證：用 helper session 實際呼叫每個 read/write endpoint，確認 response JSON、錯誤訊息與 signed URL 都沒有越權資料。

### 3.10 P0：修正 Supabase production connection 的 TLS、pool 與 timeout

- 狀態：`[~]` 目前進度已將 Transaction Pooler 與 DB CA TLS 列為待辦。
- 風險：`rejectUnauthorized: false` 會失去 DB server identity 驗證；沒有明確 pool 上限、connection timeout、statement timeout 與 idle timeout，正式環境可能在流量或 DB 異常時耗盡連線。
- 修改：使用 Supabase CA 或平台提供的驗證鏈，production 禁止關閉 certificate verification；設定 pool max、connect/idle timeout、statement timeout、transaction timeout，並確保 serverless 使用適合的 pooler。
- 驗證：錯誤憑證必須連不上、DB 延遲/斷線會快速失敗且可重試、併發請求不會無限增加 connection。

### 3.11 P0（條件式）：正式環境隔離或關閉 legacy prototype API

- 狀態：`[ ]` 需依部署拓撲確認。
- 風險：若 legacy `server.js` 與新 helper system 暴露在同一 production domain，prototype key-based auth、local JSON 或舊 API 可能成為繞過新 auth 與資料邊界的入口。
- 修改：正式環境只暴露新系統需要的 routes；legacy server 只保留本地相容用途，或以明確 network boundary/feature flag 隔離。不要讓舊 API 與新 API 共用可互換的認證假設。
- 驗證：掃描 production route、未登入 route、舊 key route 與 static upload path，確認不能讀寫新系統資料。

## 4. 建議近期修改（不一定立即出問題）

### 4.1 拆分過大的 helper service

- 將超過 5,000 行、同時處理 auth、trip、task、settlement、merge 與 photo 的 service 拆成 bounded modules。
- 先抽共用 transaction、authorization、DTO、idempotency、storage 與 error mapping，再按 domain 拆分，避免一次大改造成行為回歸。

### 4.2 為高流量列表加入 cursor pagination 與穩定排序

- trip、tasks、staging orders、merge jobs、settlements 不要永久使用無上限查詢。
- 使用 `(created_at, id)` 等穩定 cursor；前端保留 filter/sort，避免 offset 在並行新增資料時跳頁或重複。

### 4.3 降低 signed URL 的重複產生與 response 體積

- 列表 API 只回傳必要 photo metadata，需要呈現時再 lazy load 或短時間 cache signed URL。
- 不要把大量照片的 signed URL 一次塞入所有 helper/admin list response。

### 4.4 加強 relational constraints 與 ownership constraints

- 對 task、photo、staging order、trip、helper 建立 composite foreign key 或等價 server-side consistency check，避免只靠 application code 保證 parent id 一致。
- 對 owner、trip scope、task scope 使用共用 authorization function，避免不同 route 各自實作出細微差異。

### 4.5 明確保存 helper compensation rate 與 settlement audit

- compensation rate 應保存使用時的 snapshot、來源與 effective time，不要只從目前 helper profile 動態推算歷史結算。
- settlement 的 approve、adjust、paid、void 都應保存 actor、reason、before/after 與 request id。

### 4.6 統一輸入驗證、錯誤格式與移除不必要的 `as any`

- 所有 route 使用相同的 parser、validation schema 與 error envelope；將 validation error、authorization error、conflict、dependency failure 分開。
- 逐步移除 `as any`，讓 schema 型別成為 API contract，降低 migration 後欄位改名未被發現的風險。

### 4.7 建立 request id、audit event 與可觀測性

- 每次 mutation 產生 request id/idempotency id，串起 application log、DB audit、merge job 與 R2 work item。
- 對 merge、purchase、settlement、upload failure 設定可告警的 metrics，而不是只保留 console log。

### 4.8 建立 least-privilege DB role 與 RLS defense-in-depth

- application role 只取得必要 schema/table/operation 權限；service role 只在 server-side 特定工作使用。
- 若採 server-side authorization 作主防線，仍應評估 RLS 作第二層保護，並測試 helper、admin、匿名與錯誤 trip id 的資料邊界。

### 4.9 建立 orphan object 與 staging data cleanup job

- 清理過期 upload intent、未被任何 DB row 引用的 R2 object、失敗 merge 的 temporary object 與過期 staging/rebuy data。
- Cleanup 必須有 grace period、dry-run、audit 與可排除正在處理的 job，避免誤刪仍需重試的資料。

## 5. 建議但不改也不會怎麼樣（可延後）

### 5.1 統一部分 status 命名

目前不同 domain 可能使用 `reported`、`completed`、`checked_out` 等語意相近但不完全一致的名稱。只要狀態轉移與文件清楚，短期不會直接造成資料錯誤；可在下一次 schema/version migration 統一，並提供相容 mapping。

### 5.2 完整實作 issue report 的後續處理

若第一次上線只要求記錄問題、不要求客服/管理流程閉環，issue report placeholder 可先保留。但必須在 UI 與文件標示這是 scope gap，不能讓使用者誤以為已經有完整追蹤、通知與 SLA。

### 5.3 縮小 broad `revalidatePath` 範圍

廣泛 revalidation 主要是效能與快取命中率問題，不是核心資料正確性問題。流量小時可先保留，之後再按 route/tag 做精準 invalidation。

### 5.4 清理 `main.orders` 的相容 provenance 欄位

目前相容欄位可先保留，重點是新程式要以 `main.order_source_links` 為 canonical provenance。等所有 consumer 遷移並完成資料驗證後，再另開 migration 移除舊欄位。

### 5.5 小資料量前先不做所有列表 pagination

若第一次上線資料量與 helper 人數確實很小，pagination 可以晚一點做；但應保留 4.2 的 backlog，並在監控中設定 row count、response size 與 latency threshold。

## 6. 第一次上線前的驗收門檻

- [ ] 第三節 P0 項目都有 owner、PR/commit、測試與明確完成證據。
- [ ] 新增 integration tests：upload intent、idempotency、quantity、settlement snapshot、merge retry/reject、role DTO 與 session refresh。
- [ ] 使用 isolated temporary database/data/upload path 執行測試，不依賴或修改目前 `data/db.json` 與 `public/uploads/`。
- [ ] 完成真實 Supabase + R2 acceptance，包括 TLS、R2 HEAD/copy/retry、RLS/role、signed URL 與 cleanup。
- [ ] 完成 admin/helper/未登入三種角色的瀏覽器流程驗證，至少涵蓋 desktop 與 mobile viewport。
- [ ] 驗證 trip 結束、部分完成、face-check 未核准、merge 中斷、重複提交與 refresh token 過期等失敗情境。
- [ ] 確認 production 不會暴露 legacy prototype API、service key、refresh token、admin note 或其他內部欄位。
- [ ] 準備 rollback、DB migration rollback/forward plan、R2 orphan cleanup plan 與上線後監控告警。

## 7. 參考文件

- [helper-system.md](../../../docs/helper-system.md)
- [data-boundary-and-merge.md](../../../docs/data-boundary-and-merge.md)
- [database-plan.md](../../../docs/database-plan.md)
- [implementation-progress.md](../../../docs/implementation-progress.md)
- [security-hardening-plan.md](../../../docs/security-hardening-plan.md)
- [minichi_helper_system README](../../README.md)
