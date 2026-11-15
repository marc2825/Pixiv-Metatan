import { InspectionError } from '../limits';

export const localFallback = 'pixivで正規に保存できる元画像を「ローカルファイルを検査」で選択できます。';

/** Describe the failing layer without guessing the server's reason for denying it. */
export function accessExplanation(code: string, layer: 'pages' | 'original'): string {
  const target = layer === 'pages' ? '作品の画像一覧API' : 'メタデータ解析用の原寸画像';
  const status = /(?:http-)(\d{3})$/.exec(code)?.[1];
  const reason = status === '401' ? '認証が必要、またはアクセスが拒否されました。'
    : status === '403' ? 'サーバーが取得を拒否しました。ログイン・公開範囲・画像配信側の制限など、具体的な原因はこの応答だけでは特定できません。'
    : status === '429' ? 'リクエストが制限されています。しばらく待ってから明示的に操作してください。'
    : code === 'pixiv-pages-timeout' ? '通信がタイムアウトしました（15秒）。'
    : '通信・応答を確認できませんでした。';
  return `${target}を取得できませんでした: ${code}。${reason}${layer === 'original' ? 'プレビューの表示と画像バイト列の取得は別の経路です。' : ''}`;
}

export class RateLimitError extends InspectionError {
  constructor(code: string, public readonly retryMs: number) { super(code); }
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  const delay = value && /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value ?? '') - now;
  // Always pause on 429, including missing or malformed headers. Never retry automatically.
  return Number.isFinite(delay) ? Math.max(60_000, Math.min(delay, 86_400_000)) : 60_000;
}
