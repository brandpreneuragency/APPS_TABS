# GitHub mode — Faz 3 Strong servis sözleşmesi

Bu not Strong dilimidir. Luna arayüzü, OAuth ekran rehberi ve yönetici incelemesi henüz yoktur. Planın tamamı bitmiş değildir. Canlı GitHub yazma/silme, OAuth uygulama kaydı ve Windows cargo/rustc/Tauri runtime NOT RUN.

## Luna'nın kullanacağı yüzey

Store: src/stores/githubStore.ts
Servis: src/services/github/service.ts ve src/services/github/index.ts

Yeni store eylemleri: listRepoTemplates, createRepository, deleteRepository, openDeviceLogin, dismissLocalRepo.

Servis ayrıca şunları verir: captureDeleteSnapshot, proposeRepoCreate, proposeRepoDelete, beginDeleteScopeElevation.

Form şeması: REPO_CREATE_FORM_SCHEMA, REPO_DELETE_FORM_SCHEMA.
Sabitler: GITHUB_DELETE_SCOPE_NOTE, GITHUB_ELEVATED_DELETE_SCOPE, EMPTY_INITIAL_BRANCH_NOTE, LOCAL_REPO_DISMISS_NOTE, GITHUB_VERIFICATION_URI.

createRepository sonucu appliedToActive her zaman false döner. Eski create yanıtı aktif sekmeye yazılmaz. Luna oluşturulan repoyu ancak kullanıcı seçerse açar.

dismissLocalRepo ve closeRepoTab yalnızca yerel sekmeyi kapatır. DELETE göndermez.

## Oluşturma

POST /user/repos gövdesi private ve auto_init alanlarını her zaman açık gönderir. Varsayılan private true. Public yalnız visibility public ise private false olur. README, gitignore veya lisans seçilirse auto_init true olur; bu GitHub'ın şablonları ilk commite yazmasıdır, editör commit'i için gizli tohum değildir.

201 yanıtından sonra GET /user ve GET /repositories/{id} owner login, id, full_name ve private değerini doğrular. Branch, branches/{default_branch} okumasıyla doğrulanır. 409 "Git Repository is empty." boş repodur; create yanıtındaki default_branch adı var olan branch değildir.

Zaman aşımı veya 5xx ikinci POST yapmaz. Tamamlanmış sahip listesinde tam bir yeni eşleşme varsa onu okur; yoksa not_applied; birden fazlaysa ambiguous.

AI kaynaklı oluşturma proposalId ile aynı hesap, owner ve ad eşleşmeden gitmez.

## Kalıcı silme

Ayrı işlemdir. typedOwnerRepo, snapshot.fullName ile birebir aynı olmalıdır. Preflight GET /user ve GET /repositories/{id} hesap, owner, ad ve permissions.admin doğrular. x-oauth-scopes içinde repo ve delete_repo yoksa needs_scope döner ve DELETE gitmez.

Yükseltme: beginDeleteScopeElevation, scope tam olarak "repo delete_repo". Başka scope istenmez. Hesap id'si değişirse pending token atılır, eskisi commit edilmez.

DELETE 204 olduktan sonra aynı hesapla GET /user 200 ve GET /repositories/{id} 404 ise deleted. 401, 403, 404, 307, 429 ve 5xx başarı değildir. Belirsiz sonuç uncertain döner. Taslaklar ve private cache silinmez.

Yeniden adlandırma, kullanıcı değişimi veya eski onay hedefi mismatch'tir ve silmez.

## Boş repo tek commit

Doğrulanan protokol, 5 Ekim 2026:

- docs.github.com REST git/refs: boş repoda (branch yok) ref oluşturulamaz.
- GraphQL createCommitOnBranch expectedHeadOid ister; ilk ref'i üretmez.
- Tek dosya ilk commit Contents PUT ile kalır: protocol contents_bootstrap.
- Çoklu dosya tek commit, github.com smart HTTP receive-pack'tir: protocol receive_pack. Bellekte pack üretilir. Eski SHA 40 sıfırdır. force yoktur. İkinci POST yoktur.
- Fixture, GitHub'ın reddedeceği git/refs veya GraphQL çağrısını başarılı saymaz.

## Native sınır

Üretim yolu GithubNativeSession'dır. Access token, refresh token ve device_code webview'a dönmez. Fixture auth yolu nativeSession olmadan ayrı kalır.

Komutlar, invoke_handler'da kayıtlıdır. src-tauri/capabilities/default.json genişletilmedi: shell:allow-open, arbitrary URL veya ek fs izni yok.

github_open_device_login parametre almaz ve yalnız https://github.com/login/device açar. Tauri webview'da window.open veya target=_blank OS tarayıcısı sayılmaz. Luna cihaz bağlantısını openDeviceLogin ile açmalı.

github_transport_request method, url, body, auth ve bodyEncoding alır. Authorization başlığını JS ekleyemez. Native, bearer'ı keyring'den ekler. Redirect yoktur. Host yalnız api.github.com ve github.com. OAuth token uçları genel transport'tan reddedilir.

Private cache anahtarı github_cache_seal / github_cache_open ile keyring hesabı github.cache-key içinde bir kez üretilir ve JS'e okunmaz. Çıkış anahtarı siler; ciphertext kalır, okunamaz. Taslaklar kalır.

## OAuth kurulum gerçekleri (Luna rehberi buna uymalı)

- Ayar anahtarı: githubOauthClientId. Store eylemi configureClientId. Değer public client ID'dir, secret değildir. assertNoClientSecret secret alanını reddeder.
- Device flow client_secret istemez. Başlangıç POST https://github.com/login/device/code, scope yalnız repo.
- Kullanıcı sabit https://github.com/login/device adresini native komutla açar.
- Poll POST https://github.com/login/oauth/access_token, grant_type urn:ietf:params:oauth:grant-type:device_code. Secret yok.
- repo scope private repo okur ve GitHub tarafında organizasyon kaynaklarına da uygulanır. Uygulama organizasyon reposunu yine reddeder.
- delete_repo yalnız kalıcı silme yükseltmesinde istenir ve yönetilebilen repoları siler.
- GitHub OAuth uygulamasında Device Flow açık olmalıdır. Kod bunu kaydetmez.

## Doğrulama sınırı

Bu oturumda çalışan komutlar: npm run test -- altı GitHub test dosyası, 34 geçti; npm run typecheck geçti. Bunlar fixture'tır, canlı GitHub değildir. Değişen Rust dosyalarında rustfmt --edition 2021 --check geçti. Bu Windows doğrulaması değildir.

Windows cargo check, cargo test ve Tauri runtime NOT RUN. ATLAS Linux'tur; sistem geneli Rust kurulmadı ve crate indirilmedi. src-tauri/capabilities/default.json değiştirilmedi.
