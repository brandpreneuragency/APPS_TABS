# Yerel orchestrator başlangıç promptu

> **Çalıştırma: tarihsel prompt.** [Etkin sıralı paket](../SUPERSEDED.md) bu talimatların yerini aldı.

TABS Clients implementation paketini uygula.

Repository:
C:\Users\burak\MOTHER\PROJECTS\TABS-local

Plan package:
C:\Users\burak\MOTHER\PROJECTS\TABS-local\TABS-Clients-Planning (tarihsel kopya)

Önce README, 01 plan, 02 attended preflight, 03 contracts, 04 ownership, 05 acceptance, 06 execution ve execution-ledger.json oku. Repo/subtree AGENTS.md'yi yeniden oku. Bu paket kaynak + verified isolated Windows Tauri app teslimi içindir. Installer, installed app migration, yayın ve gerçek müşteri email testi yetkisi yoktur.

1. Mevcut git status/diff ve ledger'dan devam et. Kullanıcı WIP'ini, silinmiş eski planı, credentials/veritabanlarını ve çalışan production app'i koru. Branch/worktree/commit/push/stash/reset/clean/restore yok.
2. P0 yapılmamışsa bounded discovery/baseline yap. P1 tamamlanmamışsa yalnız attended preparation aşamasına geç; kullanıcı bulunmadan OAuth/setup/recipient izni uydurma. Ana paralel feature koşusunu başlatma.
3. P1 için prompts/p1.md'yi, native izolasyonu ve actual live Gmail proof'larını tamamla. Secret/address/body çıktı verme. Refresh/restart, receiver observer ve bounded permit hazır olmalı.
4. scripts/Test-LaunchGate.ps1 exit 0 olmadan P2/P3 launch yok. Gate eksikse yeni login/setup gereksinimini açıkça attended aşamada tamamla.
5. P2 contracts/review freeze. Up to 3 concurrent workers + 1 parent; runtime desteklemiyorsa aynı packet'leri sırayla uygula. Available roles/models gerçek atamayla ledger'a yaz; eski model adlarını taşımama. Workers recursive spawn yapmaz.
6. Workers'a ayrı prompts/p3-a.md, p3-b.md, p3-c.md ve gerektiğinde p4-* promptlarını ver. Exact write locks tut; shared types/schema/routes/catalogs/native registration/dependencies parent'ta. Parent ownership devrini açık kaydetmeden iki worker aynı dosyayı değiştiremez.
7. Her producer focused tests + farklı yazarlı review ile verified olur. Consumer contract değişikliği istiyorsa version/hash ve stale evidence güncelle. Fixtures development içindir; actual service/native integration çıkış kapısını geçmelidir.
8. P5 integration/review bitince yazarları durdur. P6 komutlarını bir coordinator çalıştırır. Separate CARGO_TARGET_DIR + no-bundle config; production instance'a dokunma.
9. Tam Clients UI'ında final native/live suite'yi hazır credentials/receiver observer ve izin kotasıyla çalıştır. Preflight probe veya browser/compile başarısını final UI kabulü sayma.
10. Yeni external auth/network blocker olursa progress/drafts/ledger'ı koru; bağımsız işleri bitir; live gate'i fake geçirme. Safe recovery rules ile resume hazırla.
11. P7'de behavior/files, migrations/retention, exact commands/exit codes/totals/warnings, real executable/config/hash, live evidence ve installed app'in korunması raporlanır. Gerekli gate'ler passed olmadan complete yazma.

İlerleme sırasında kaydedilen dosyaların yolunu bildir. Kullanıcıya yeni izin sorusu yalnız gerçekten eksik provider mutation/test-send yetkisi için ve gerekçesiyle sorulur; onaylı çalışmayı tekrar tekrar teyit ettirme.
