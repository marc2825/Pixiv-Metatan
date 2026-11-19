import { InspectionError } from '../limits';
import { emptyResult, type InspectionResult } from '../metadata/types';

/** The supported recovery path when the original cannot be fetched. No bypass is attempted. */
export const localFallback = '原寸を確認するには、pixivの作品ページで原寸画像を表示してブラウザで保存し、「ローカルファイルを検査」で選択してください（正規に閲覧・保存できる画像のみ）。';

const ORIGINAL_403 = 'i.pximg.netはRefererのない取得を拒否することを確認しています（2026-11-19の実測: Cookie・Refererなしで原寸・縮小とも403）。この拡張は制限回避のためのReferer付与・Cookie移植・代理取得を行わないため、通常この方法では取得できません。公開範囲などの別の理由の可能性もあります。';

/** Describe the failing layer from the observed status; do not invent the server's reason. */
export function accessExplanation(code: string, layer: 'pages' | 'original', detail?: string): string {
  const target = layer === 'pages' ? '作品の画像一覧（pixiv API）' : '解析用の原寸画像（i.pximg.net）';
  const status = /(?:^|-)http-(\d{3})$/.exec(code)?.[1];
  const reason = status === '401' ? '認証が必要、またはアクセスが拒否されました。'
    : status === '403' ? (layer === 'original' ? ORIGINAL_403 : 'pixivが拒否しました。ログイン状態・公開範囲・年齢制限などが考えられますが、この応答だけでは特定できません。')
    : status === '404' ? '見つかりません。削除・非公開・URL変更の可能性があります。'
    : status === '429' ? 'リクエストが制限されています。待機時間が過ぎてから、もう一度明示的に操作してください。自動再試行はしません。'
    : Number(status) >= 500 ? 'サーバー側のエラーです。時間をおいてから明示的に操作してください。'
    : /timeout$/.test(code) ? '通信がタイムアウトしました（15秒）。'
    : code === 'pixiv-pages-error' ? 'pixivがエラーを返しました。'
    : code === 'pixiv-pages-content-type' ? 'JSON以外の応答でした（ログイン画面などの可能性）。'
    : /schema|json|mismatch/.test(code) ? '応答の形式・作品番号が想定と異なるため、安全のため使用しませんでした。'
    : /redirect/.test(code) ? 'リダイレクトは追跡しません。'
    : /content-type/.test(code) ? '画像以外、または宣言と中身が一致しない応答でした。'
    : code === 'current-context-mismatch' ? 'ページが移動したため中止しました。'
    : code === 'unapproved-image-url' ? '検査対象として認められないURLです。'
    : '通信できませんでした（ネットワーク切断・拡張の再読み込みなど）。';
  const server = detail ? `pixivの応答:「${detail}」` : '';
  return `${target}を取得できませんでした（${code}）。${reason}${server}`;
}

export function errorCode(error: unknown): string {
  return error instanceof InspectionError ? error.code : 'network-error';
}
export function errorDetail(error: unknown): string | undefined {
  return error instanceof InspectionError ? error.detail : undefined;
}

export class RateLimitError extends InspectionError {
  constructor(code: string, public readonly retryMs: number) { super(code); }
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  const delay = value && /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value ?? '') - now;
  // Always pause on 429, including missing or malformed headers. Never retry automatically.
  return Number.isFinite(delay) ? Math.max(60_000, Math.min(delay, 86_400_000)) : 60_000;
}

export function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 120 ? `${seconds}秒` : `${Math.ceil(seconds / 60)}分`;
}

/**
 * Tab-memory cooldown. The worker keeps its own cooldown, but an MV3 service worker may be
 * restarted and lose it; this copy keeps the tab from sending another original request early.
 */
export class Cooldown {
  private until = 0;
  constructor(private readonly now = Date.now) {}
  block(ms: number): void { this.until = Math.max(this.until, this.now() + Math.max(0, Math.min(ms, 86_400_000))); }
  remaining(): number { return Math.max(0, this.until - this.now()); }
  clear(): void { this.until = 0; }
}

/** Remember a worker-reported 429 in this tab as well (the worker may restart and forget). */
export function noteRateLimit(cooldown: Cooldown, result: InspectionResult): void {
  if (result.error?.layer === 'original' && result.error.retryAfterMs) cooldown.block(result.error.retryAfterMs);
}
export function cooldownResult(remaining: number): InspectionResult {
  return {
    ...emptyResult('access-denied', [`${accessExplanation('http-429', 'original')}あと約${formatWait(remaining)}はこのタブから原寸を取得しません。`, localFallback]),
    error: { layer: 'original', code: 'http-429', retryAfterMs: remaining },
  };
}
