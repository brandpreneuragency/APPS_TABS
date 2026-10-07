# GitHub mode — Faz 2 Strong servis sözleşmesi

Bu not yalnız backend dilimidir. Luna Faz 2 Light arayüzü ve Faz 3 henüz yoktur. Planın tamamı bitmiş değildir. Canlı GitHub yazma, OAuth kaydı ve Windows cargo/rustc NOT RUN.

## Luna'nın kullanacağı yüzey

Store: src/stores/githubStore.ts
Servis: src/services/github/service.ts ve src/services/github/index.ts

Yeni store eylemleri: refreshRemote, commitSelected, searchRepository, createBranch, stageDirectory, stageUpload, resolveConflict, grantAiConsent, revokeAiConsent, prepareAi, loadHistory.

commitSelected kullanıcı onaylı CommitConfirmation ister. AI tool permissionMode veya bypass alanı bu onayı kaldırmaz. rejectAiRemoteMutation(true) bile uzak yazmaz.

## Atomik commit

Seçilen taslaklar aynı base tree üstünden blob + tek tree + tek commit + PATCH ref force=false olur. Contents API dosya başı commit üretmez.

Boş repo: docs.github.com REST git/refs, 5 Ekim 2026, boş repoda (branch yok) ref oluşturmayı reddeder. Tek seçili dosya bir Contents PUT ile tek commit bootstrap olur ve protocol contents_bootstrap döner. Çoklu seçim empty_repo_atomic_unavailable döner; per-file Contents çağrılmaz ve git/refs uydurulmaz. Git CLI eklenmedi.

Kirli yenileme baseCommitSha değiştirmez. Çözülmemiş çakışma gönderimi bloklar. Gönderimden sonra yalnız doğrulanan editVersion silinir. Belirsiz timeout ikinci commit yaratmaz. Korunan branch force edilmez.

## Diff ve çakışma

Üç yönlü metin birleştirme diff3 paketidir (Khanna/Kunal/Pierce). Ev yapımı merge yoktur. Binary, silme-değiştirme ve rename collision için both reddedilir. Side-by-side/inline renderer Luna işidir. Kaynaklar draft.originalText, draft.newText ve conflict.remoteText.

## Arama ve binary

Repo ağacı + yerel taslak overlay. truncated, fetch cap, boyut veya rate limit varsa complete false. Symlink, submodule ve LFS takip edilmez. Boş klasör kalıcı değildir; .gitkeep yalnız explicitGitkeep true ile.

Özel blob indirme GET /git/blobs/{sha} Accept application/vnd.github.raw+json ve bodyBase64. raw.githubusercontent.com yok. PDF/görsel metne çevrilmez.

## AI

Private repo için hesap+repo opt-in. İzinsiz provider çağrısında dosya, diff, context, tool output, history ve attachment sıfırdır. İptal bekleyen Codex turn'ünü startTurn öncesi durdurur ve kuyruk metnini temizler. Daha önce giden içerik geri alınamaz: GITHUB_AI_RECALL_WARNING. GitHub yolu Docs editor path context'ine düşmez; github: ve ghrepo: path'leri captureCodexScope dışındadır.

## Native

github_transport_request artık body doğrular, force true ve raw host reddeder, sonra native_http_not_linked döner. Capability genişletilmedi. Windows cargo fmt/check/test NOT RUN.
