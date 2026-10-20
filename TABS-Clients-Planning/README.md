# TABS Clients — implementation paketi

> **Tarihsel paket 1.0.** Etkin plan artık `C:\Users\burak\MOTHER\PLANS\26-09-27-06.28-TABS-Clients` altında.
> [Yeni paket ve devam açıklaması](SUPERSEDED.md). Aşağıdaki eski paralel çalışma/G1 talimatlarını çalıştırma.

27 Eylül 2026 · Paket 1.0 · Sözleşme adayı CL-C1

**Durum: P0 baseline geçti; Google girişi, doğru hesap/kapsamlar, yeniden başlatma sonrası gerçek token yenileme ve salt okunur Gmail listeleme erişimi doğrulandı. Kullanıcının hız önceliğiyle ayrıntılı posta/ek/gönderim testleri ertelendi; tam G1 pending.**
Hedef, Windows Tauri uygulamasına çalışan Clients modülü eklemek ve ayrı bir native test uygulamasında doğrulamaktır. Teslim seviyesi A: kaynak + doğrulanmış izole uygulama. Installer, kurulum, yayın ve kurulu TABS verisi üzerinde geçiş bu çalışmaya dahil değildir.

## Okuma ve çalışma sırası

1. [Implementation plan](01-implementation-plan.md): kararlar, aşamalar ve bitiş koşulları.
2. [Attended preflight](02-attended-preflight.md): kullanıcı eşliğindeki Google hazırlığı ve ana koşunun giriş kapısı.
3. [Veri ve servis sözleşmeleri](03-contracts.md): çalışanların ortak uygulayacağı CL-C1.
4. [İş paketleri ve sahiplik](04-work-packets.md): bağımlılıklar, dosya sınırları, doğrudan kullanılabilir worker promptları.
5. [Kabul matrisi](05-acceptance.md): bütün briefing gereksinimlerinin test ve native kanıt karşılığı.
6. [Yürütme ve devam kuralları](06-execution.md), [ledger](execution-ledger.json), [preflight receipt şablonu](preflight-receipt.template.json).
7. [Orchestrator başlangıç promptu](prompts/00-orchestrator.md).

Kaynak briefing: [okunan belgenin değişiklik yapılmamış kopyası](brief/requirements.md).
[Planlama inceleme raporu](reports/planning-review.md) hangi bulguların güncel kaynak incelemesine dayandığını açıklar.
[Güncel P1 hazırlık raporu](reports/p1-auth-bootstrap.md), çalışan test exe'sini, doğrulamaları ve eksik kalan kabul adımlarını listeler.

## Başlangıç kapısı

P0 keşif ve P1 küçük native/Gmail hazırlığı kullanıcı eşliğinde yürütülür. P1'in başarılı kanıtı olmadan P2 ve ana paralel geliştirme başlamaz. Bu bir planlama belgesidir; receipt dosyası başlangıçta bilerek `pending` durumundadır.

`scripts/Test-LaunchGate.ps1`, gerçek probe çıktılarını ve dosya hash'lerini denetler. P1'in geliştireceği `scripts/clients/Invoke-ClientsReadiness.ps1` üzerinden aynı native adapter ile güncel, salt okunur bağlantı kontrolü ister. Plan paketindeki script tek başına Gmail adapter değildir. Eksik kanıt veya adapter ile başarılı sonuç vermez.

## Temel uygulama kararları

- Mevcut `crmMode + activeCRMPage='clients'` route'u kullanılır. İkinci bir marka listesi veya seçimi kurulmaz.
- Profil, kişi, not ve yazışma kayıtları mevcut `ZenEditorDB` içine eklenir. Pasif CRM/Forms veritabanı ayrı kalır.
- Native Gmail adapter tokenları tutar; React yalnızca domain verisi alır. Tek aktif mailbox, yerel taslaklar ve açık Send eylemi.
- HTML email v1'de güvenli düz metne dönüştürülür. Uzak resimler otomatik yüklenmez.
- Silinen markanın arşivi erişilebilir, yeniden bağlanabilir durumda tutulur. Belirsiz gönderim otomatik tekrarlanmaz.
- Bir parent ve en fazla üç worker; aynı dosyaya eşzamanlı iki yazar yoktur. Model adı veya bütçe dayatılmaz.

## Dosya konumu ve veri sınırı

Bu tarihsel paketin konumu `C:\Users\burak\MOTHER\PROJECTS\TABS-local\TABS-Clients-Planning` dizinidir. Etkin yürütme konumu [SUPERSEDED.md](SUPERSEDED.md) içinde belirtilir. Briefing'deki eski çıktı yolu yeniden oluşturulmadı. Projedeki özgün briefing korunur.

Gerçek adres, posta içeriği, OAuth yapılandırması, token, test alıcı listesi ve çalışma veritabanları pakete konmaz. Bunlar izole uygulamanın yerel korunan alanında kalır. Screenshotlar yalnızca sentetik içerikle `C:\Users\burak\MOTHER\MEDIA\screenshots` altında tutulur.
