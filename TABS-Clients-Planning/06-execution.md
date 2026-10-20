# Yürütme, ownership ve resume

## Durum modeli

Packet: pending → ready → in_progress → implemented → review → verified.
Yan durumlar: blocked_external, blocked_code, stale. `implemented` test/acceptance anlamına gelmez. Dependency ancak packet'in ilgili çıkış gate'i verified ise tüketilir.

Ledger [execution-ledger.json](execution-ledger.json) başlangıçta bütün packet'leri pending tutar. Parent her batch'te owner/runtime model, exact writeSet, contract hash, source fingerprint, commands/exit codes, findings ve proof reference günceller.

Bir findings kaydı: id, severity, affected requirement, file/line, reproduction, owner, status, fixFingerprint, retestEvidence. Critical/high açıkken bağımlı güvenlik/persistence gate geçmez.

## Source ve kanıt hash'leri

Candidate fingerprint yalnız HEAD değildir: src/, src-tauri/ (ignored build outputs hariç), scripts/, public/, package/lock, TS/Vite/Vitest/ESLint config ve index.html dosyalarının path+SHA-256 listesi. Tracked deletion MISSING olarak dahil edilir. User'ın ilgisiz untracked dizinleri envanterde korunur, okunup pakete taşınmaz. Plan dokümanları code fingerprint'e katılmaz; contract ayrıca hash'lenir.

PF receipt, bootstrap source/adapter/exe/config hash'lerini taşır. P6 final receipt yeni source/exe hash'i ve hangi PF kanıtlarının hâlâ geçerli olduğunu belirtir. Adapter/auth/MIME/identity değiştiyse etkilenen live proof tekrar gerekir; açıklama yazmak revalidation yerine geçmez.

## Kesilmeden ana koşuya giriş

1. P0/P1 hazır ve owner eşliğindeki işler tamamlanmış.
2. Test-LaunchGate.ps1 exit 0 ve fresh no-send readiness.
3. Parent P2 freeze/review yapar.
4. P3/P4 ownership ile dağıtılır; parent shared dosyaları sırayla entegre eder.
5. Runtime tools/model adları gerçek atamalar olarak kaydedilir. Delegation yoksa sequential.
6. Test invocation'ları ve private send quotas tek coordinator'da.

P1 bitmeden ana run'a “kesintisiz başlayabilir” denmez. P1 hazırlığı için ayrıca broad ürün görüşmesi gerekmez; yalnız Google/setup/test recipient gibi somut eksikler kullanıcı eşliğinde çözülür.

## Retry ve recovery

- Transient test/build tooling failure: sebebi doğrula, en fazla 2 aynı yöntem retry. Üçüncü denemeden önce parent/reviewer yeni teşhis veya farklı yaklaşım ister.
- Provider read retry contract'taki bounded backoff; mutating send retry tamamen send state machine'e bağlıdır.
- Token revoke/admin/network blocker: fixture ve bağımsız source/UI işleri sürer; gerçek live gate pending/blocked_external kalır.
- DB/filesystem partial commit: operationId journal replay, revision/epoch kontrolü, duplicate prevention; eski veriyi silerek baştan başlama yok.
- Worker kesilmesi: sahibi inactive işaretlenir, dosyaların gerçek diff'i incelenir, lock tek kişiye devredilir. Apply edilmiş patch tekrar oynatılmaz.
- Contract change: parent sürüm/hash artırır; etkilenen producer/consumer ve evidence stale; bağımsız paketler ilerleyebilir.
- Migration hatası: yalnız isolated fixture/profile; production data'ya müdahale yok. Kısmen migrate olmuş test DB üzerinde bütün tabloları temizleyip “başardı” deme; failed upgrade recovery ayrıca test edilir.
- Task-owned process kapatma PID+exe path doğrulanarak yapılır; production tabs.exe veya diğer process'ler adına göre topluca öldürülmez.
- Dosya cleanup yalnız belirli operation'ın own temp/staging dosyası ve doğrulanmış root içinde. Recursive blanket delete, keyring/cache temizleme yok.

## Kapanış

P7 raporu özet davranış, changed source paths, storage/retention ve migration notları, bütün komutların gerçek exit code/totals/warnings'i, final isolated exe/config identity ve live Gmail kanıtını içerir. Installer üretilmedi/kurulmadı ve installed app değişmedi sonuçları evidence'a dayanır.

Herhangi bir required gate eksikse tamamlandı etiketi yoktur; verified kaynak işleri ve remaining external blocker ayrı yazılır. Sonraki kullanıcı/agent için exact resume step ve gereken somut dış eylem bırakılır.
