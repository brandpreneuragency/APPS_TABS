# İş paketleri ve exclusive dosya sahipliği

Repo: `C:\Users\burak\MOTHER\PROJECTS\TABS-local`.
Her prompt [prompts/](prompts/00-orchestrator.md) altında tek başına atanabilir. Parent atama anında exact dosya listesi ve contract hash'i ledger'a koyar; aşağıdaki directory prefix'leri başka worker'a aynı anda verilemez.

## Parent'a ayrılan shared dosyalar

- `src/App.tsx`, `src/components/header/ModeNavigation.tsx`, `Header.tsx`, `src/components/layout/CRMWorkspace.tsx`, `LeftNarrowSidebar.tsx`, `AppLayout.tsx`, `src/components/clients/ClientsWorkspace.tsx` ve aynı alanların mevcut testleri.
- `src/types/index.ts`, `src/types/clients.ts`, `src/types/gmail.ts`, `src/services/db.ts`, `src/stores/uiStore.ts`, `uiLayoutState.ts`, `clientStore.ts`, gerekirse task/project store entegrasyonu ve bunların testleri.
- `src/services/runtime.ts`, `src/services/updater.ts`, `src/services/clients/ports.ts`, `src/services/clients/contracts.test.ts`, `src/services/codex/migration.test.ts`.
- `src-tauri/src/lib.rs`, `main.rs`, `tray.rs`, `commands/mod.rs`, `commands/gmail.rs`, `src-tauri/src/acceptance/`, `src-tauri/capabilities/`, `src-tauri/permissions/`, acceptance config.
- package.json/package-lock.json/Cargo.toml/Cargo.lock; EN/TR catalogs; gerekli ortak CSS/token değişiklikleri; `scripts/clients/`.
- Bu plan paketi, ledger, receipts ve reports.

Boş write set'i olan parent packet'leri yalnız ilgili aşama için bu shared alanları ve dokümanları kullanır; repo genelinde sınırsız düzenleme izni değildir. Worker shared değişiklik ihtiyacını path + beklenen davranış + contract/test etkisiyle parent'a iletir. Parent uygular veya sahipliği tek kişiye açıkça devreder. Reviewer source dosyasına yazmaz; findings parent'ın raporuna aktarılır.

P1'in B native/transport alanları P3-B'ye, diğer producer alanları consumer aşaması başlamadan parent'a serbest bırakılır. P4 consumer'ın producer dosyasına değişiklik ihtiyacı varsa transfer ledger'da yapılır; iki writer yoktur. Build/test output'u tek coordinator yönetir.

## Çalışma dalgaları

`P0 → P1/G1 → P2/G2 → (P3-A ∥ P3-B ∥ P3-C) → (uygun P4-A ∥ P4-B ∥ P4-C) → P5 → P6 → P7`

P4-A/C, P3-B sürerken dependency'leri hazırsa başlayabilir; toplam worker sayısı 3'ü geçmez. P4-B bütün foundation producer'ları bekler. Riskli foundation'ı yazmayan bir worker review için boşaltılır. Worker recursive spawn yapmaz. Available runtime/model assignments ledger'a gerçek değer olarak yazılır; eski planlardan model adı alınmaz.

## Paket özeti

| ID | Sonuç | Needs | Prompt |
|---|---|---|---|
| P0 | Keşif ve baseline | — | [P0](prompts/p0.md) |
| P1 | İzole native bootstrap ve attended Gmail | P0 | [P1](prompts/p1.md) |
| P2 | Contract freeze ve parent entegrasyon temeli | P1 | [P2](prompts/p2.md) |
| P3-A | Yerel kayıt ve persistence foundation | P2 | [P3-A](prompts/p3-a.md) |
| P3-B | Native Gmail sync/send/files foundation | P2 | [P3-B](prompts/p3-b.md) |
| P3-C | Clients shell ve view state | P2 | [P3-C](prompts/p3-c.md) |
| P4-A | Profile ve Notes deneyimi | P3-A, P3-C | [P4-A](prompts/p4-a.md) |
| P4-B | Conversations ve email composer | P3-A, P3-B, P3-C | [P4-B](prompts/p4-b.md) |
| P4-C | Overview ve mevcut işe geçiş | P3-A, P3-C | [P4-C](prompts/p4-c.md) |
| P5 | Entegrasyon ve bağımsız inceleme | P4-A, P4-B, P4-C, P3-B | [P5](prompts/p5.md) |
| P6 | Final source/native/live gates | P5 | [P6](prompts/p6.md) |
| P7 | Teslim ve devam kaydı | P6 | [P7](prompts/p7.md) |

Her prompt: requirement IDs, inspect set, exclusive write set, contract inputs/outputs, implementation steps, tests, integration/review, recovery ve completion evidence içerir. Parent önce packet promptunu ve CL-C1'i okutur; yalnız görev başlığıyla worker başlatmaz.
