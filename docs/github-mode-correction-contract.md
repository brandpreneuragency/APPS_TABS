# GitHub mode correction contract

This note is for the remaining Luna UI integration. It does not complete the plan.

Backend callers must keep these contracts:

- Draft identity stays account id + repo id + ref + path. Empty text or empty binary is legal content. null means the content is absent. A newer edit version is not deleted when an older commit is acknowledged.
- Tree updates include the existing 100644 or 100755 mode. New files use 100644. Symlink, submodule, and LFS entries are not followed.
- Native transport accepts only Accept, Content-Type, and X-GitHub-Api-Version. Authorization stays native. Do not send OAuth token endpoints or credential headers through the generic transport.
- Repository creation is created only when the requested owner, name, privacy, and initial-content choice match the readback. A wrong or public echo is not success.
- Provider threads use workspace id github:accountId:repoId:encodedRef. A persisted thread cannot be rebound by a watch. Docs editor context is not a GitHub fallback.

Luna still owns the GithubWorkspace.test.tsx description fixture type error and the remaining form, device-link, and OAuth setup guide. Windows cargo, Tauri, and live GitHub were not run.
