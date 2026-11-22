# Release checklist

Status 2026-11-22. Reasons and evidence are in [TEST_STATUS.md](TEST_STATUS.md#公開判定-2026-11-22).

| Target | Verdict | What is left |
|---|---|---|
| Source code on GitHub | **GO** | Switch the repository to public, then apply the GitHub settings below |
| Packaged development build (GitHub Releases) | **NO-GO** | Live acceptance (#11), real Edge, release notes |
| Chrome Web Store | **NO-GO** | Everything for Releases, plus the store requirements below |

## Done
- [x] Pre-publication audit: PR #8, merged 2026-11-21 as `3c82536`; CI run 44846975048 green on `main`. It covered the full-history secret scan (no credentials), `THIRD_PARTY_NOTICES.md`, SECURITY.md, `.gitignore` hardening, actions pinned by SHA, and `npm audit` and gitleaks jobs.
- [x] Issues #9, #10, #13–#17 resolved (2026-11-22): narrow pixiv Referer for the extension's own original request, Stealth row limit, EXIF unrelated tags, hover traffic, standalone local inspector, manifest policy, and this documentation sync.
- [x] Automated, all synthetic and all in CI: typecheck, Vitest (15 files / 412 tests), Chrome and Edge builds, manifest guard, browser UI 12, production MV3 18, `npm audit`, gitleaks.
- [x] Live, at the HTTP and worker level only: pages API 200; original 403 without and 200 with the pixiv Referer; production worker fetch 200 in Chromium 156.
- [x] Locked, exact devDependencies; no runtime dependencies besides the bundled WXT runtime (MIT); no third-party artwork, telemetry or credential handling.

## Source publication (GitHub)
- [ ] Maintainer switches the repository to public.
- [ ] Right after, under Settings → Advanced Security (Code security), enable **Private vulnerability reporting** (public repositories only), **Dependabot alerts**, **Dependabot security updates**, **Secret scanning** and **Push protection**. CodeQL default setup is optional.
- [ ] Settings → Rules → Rulesets: protect `main` (pull request required, no force push or deletion). Required checks: `Typecheck, unit tests, Chrome/Edge MV3 builds (Node 22)`, `(Node 24)`, `npm audit (high and critical)`, `Secret scan (gitleaks, full history)`. Add the Playwright job once it has stayed stable.
- [ ] Settings → Actions → General: keep workflow permissions read-only; require approval for fork PR workflows (at least first-time contributors).
- [ ] Optional: delete old `synthetic-mv3-report` artifacts (raw reports with runner paths and the author email) or let them expire; add a description and topics.

## Packaged development build (GitHub Releases)
- [ ] #11: manual acceptance in a normal Chrome ([MANUAL_TESTS.md](MANUAL_TESTS.md) 1–10), logged out and logged in. This includes **Metadata on a real pixiv page**; only the worker request path has been verified live so far.
- [ ] Real Edge and minimum version 120.
- [ ] Release notes: what is synthetic and what is live-verified, the pixiv Referer on the extension's own original request (scope and permission), the local-file route, and that signatures are not verified.
- [ ] `npm run zip` / `npm run zip:edge` from a clean checkout; attach SHA-256 values; explicit maintainer approval to tag and publish.

## Chrome Web Store
- [ ] All packaged-release items.
- [ ] Public privacy policy URL (based on [PRIVACY.md](PRIVACY.md)); data-use disclosure (no data collected).
- [ ] Single-purpose description; justification for both host permissions and `declarativeNetRequestWithHostAccess` (the pixiv Referer on the extension's own original request).
- [ ] Review use of "pixiv" in the name and listing, and pixiv's terms, including the Referer approach.
- [ ] Store screenshots from synthetic pages only (icons are in `public/icon/`).
- [ ] Optional: results of #12, to set expectations in the listing.
