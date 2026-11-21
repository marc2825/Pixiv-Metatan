# Release checklist

Status 2026-11-21: **source publication: conditional GO (merge the pre-publication PR); packaged release and Chrome Web Store: NO-GO** (reasons in [TEST_STATUS.md](TEST_STATUS.md#公開判定-2026-11-21)).

## Automated (done in this repository)
- [x] Locked, exact devDependencies; `npm audit`: 0 vulnerabilities; no runtime dependencies besides the bundled WXT runtime (MIT).
- [x] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:edge`, `npm run check:manifest` pass.
- [x] `npm run test:browser` and `npm run test:extension` pass locally against synthetic responses.
- [x] Manifest: no API permissions; hosts `www.pixiv.net` and `i.pximg.net` only; top-frame isolated content script; icons present.
- [x] Parsers cross-checked with upstream-verified synthetic fixtures (NovelAI writer/reader, ComfyUI, AUTOMATIC1111).
- [x] No third-party artwork, R18 images, uploads, telemetry, credential handling or bypass mechanisms.
- [x] README, SECURITY and PRIVACY match the implementation.

## Before publishing the source on GitHub
- [x] Full-history secret audit: gitleaks plus a custom scan of every blob, image metadata, CI logs, artifacts and PR text. No credentials ([summary](TEST_STATUS.md#pre-publication-audit-2026-11-21)).
- [x] No local paths or machine-specific values in current files; `.gitignore` covers secrets, signing keys, browser state, traces, HAR and local environments.
- [x] LICENSE (MIT), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), trademark disclaimer, SECURITY.md with an interim reporting route.
- [x] CI green on GitHub, read-only token, actions pinned by SHA, `npm audit` and gitleaks jobs, sanitized artifacts only.
- [ ] Merge the pre-publication PR after its CI passes.

## Right after switching to public (GitHub settings)
These can only be changed in the repository settings. Private vulnerability reporting is available only for public repositories.
- [ ] Settings → Advanced Security (Code security): enable **Private vulnerability reporting**, **Dependabot alerts**, **Dependabot security updates**, **Secret scanning** and **Push protection**. Optionally enable CodeQL default setup.
- [ ] Settings → Rules → Rulesets (or Branches): protect `main`. Require a pull request and the status checks `Typecheck, unit tests, Chrome/Edge MV3 builds (Node 22)`, `(Node 24)`, `npm audit (high and critical)` and `Secret scan (gitleaks, full history)`. Block force pushes and deletion. Add the Playwright job after it has stayed stable.
- [ ] Settings → Actions → General: keep **Workflow permissions** at "Read repository contents"; set fork pull request workflows to require approval (at least for first-time contributors).
- [ ] Optional: delete the old `synthetic-mv3-report` artifacts (raw Playwright reports with runner paths and the commit author email) or let them expire (14-day retention).
- [ ] Optional: add a repository description and topics; disable Wiki/Projects if unused.

## Before a packaged release (GitHub Releases)
- [ ] Manual live acceptance in a normal Chrome on owner-controlled or legitimately viewable artwork ([MANUAL_TESTS.md](MANUAL_TESTS.md) items 1–8), logged out and logged in.
- [ ] Real Edge and minimum version 120.
- [ ] Release notes state plainly that **Metadata** fetching is expected to be rejected (403) and that local files are the supported route.
- [ ] Build with `npm run zip` / `npm run zip:edge` from a clean checkout; attach SHA-256 of the zips.
- [ ] Explicit maintainer approval for tagging and publishing.

## Before the Chrome Web Store
- [ ] All packaged-release items.
- [ ] Public privacy policy URL (can be based on `docs/PRIVACY.md`) and data-use disclosures (no data collected).
- [ ] Single-purpose description; justification for the two host permissions.
- [ ] Store screenshots from synthetic pages only; 128 px icon (provided in `public/icon/`).
- [ ] Review use of the third-party name "pixiv" in the extension name and listing, and pixiv's terms, for the shipped UX.
- [ ] Decide whether a listing is appropriate while the **Metadata** fetch fails on real pixiv by policy.
