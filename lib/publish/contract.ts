/**
 * lib/publish/contract.ts — 🔴 B ↔ B2 경계 정본(P1R2 계약 §10). 순수 타입 + 상수만(런타임 부작용 0 · 임포트는 타입뿐).
 *   AC 신규 2026-09-14 (B2). 관례 출처: ../AutoMarketing/lib/publish-threads.ts (커넥터 반환 모양).
 *
 *   B 가 쓰는 것은 두 함수뿐이다:
 *     · `publish(piece, account, opts?)`            — lib/publish/index.ts   (크론 publisher 스텝)
 *     · `finalizePublish(pieceId, input)`           — lib/publish/finalize.ts (B2 의 러너 report 가 호출 · B 는 직접 부르지 않는다)
 *   편의용 `publishPieceById(tenantId, pieceId, opts?)` 도 index.ts 가 내보낸다(행 로드까지 B2 가 한다).
 *
 *   🔴 상태를 쓰는 자리는 하나다: posts 행·piece.status/published_at/external_url·slot.status·accounts.posts_today/last_post_at 는
 *      **finalizePublish 만** 건드린다. B 의 publisher 는 publish() 반환을 보고 «슬롯 상태»만 옮긴다(publishing·awaiting_runner·awaiting_manual).
 *   🔴 자격 평문은 이 파일의 어떤 타입에도 없다. publish() 내부에서만 복호화하고, 러너 claim 응답에만 실린다(DESIGN §7.1 평문 표면 2곳).
 */
import type { Block } from "../blocks";
import type { GateReport } from "../ai-tell-gate";
import type { PhotoSource, StockMeta } from "../photo-source";   // [2026-09-16] 크레딧 재료 — 발행까지 들고 간다
import { API_CHANNEL_KEYS, RUNNER_CHANNEL_KEYS, publishViaOf as registryPublishViaOf } from "../channel-registry";   // [P1R8 §5.2] 발행 경로 정본(순수 리프)

export type { GateReport };

/* ─────────────────────────── 채널 라우팅 ─────────────────────────── */

/**
 * **커넥터가 어느 길로 올렸나** — 두 값뿐이다. 우리 코드가 올리는 길은 API 아니면 러너다.
 * 🔴 여기에 `"manual"` 을 넣지 마라. 커넥터는 «사람이 직접 올렸다»를 **반환할 수 없다**(그럴 땐 애초에 안 불린다).
 *    union 을 넓히는 순간 `publisher.ts` 의 `via` 분기가 «커넥터가 manual 을 돌려줄 수도 있는» 모양이 되어 뜻이 흐려진다.
 */
export type PublishVia = "api" | "runner";

/**
 * **DB `posts.published_via` 에 적히는 값** — 3값이다(`drizzle/0001-init.sql:390`).
 * 커넥터가 못 만드는 `"manual"`(사람이 앱 밖에서 올리고 주소만 적어 준 것 · B-1 §1.3)이 여기엔 있다.
 * 🔴 «커넥터가 돌려주는 값»과 «DB 에 적히는 값»은 **다른 개념**이라 타입을 나눈다 —
 *    한 타입으로 겸용하면 둘 중 하나를 넓혀야 하고, 그러면 다른 쪽의 뜻이 망가진다(B-1 지적 2026-09-15).
 */
export type PublishedVia = PublishVia | "manual";

/** 서버(API)에서 바로 발행하는 채널. P1R5 — 영상 3종(유튜브·릴스·스레드)은 **OAuth API** 로 올린다. */
export const API_PUBLISH_CHANNELS: ReadonlySet<string> = API_CHANNEL_KEYS;
/** 러너(브라우저 자동화)로만 발행되는 채널. P1R5 — 네이버 클립은 러너 잡으로 예약하되 **스텁**(정직하게 막는다 · §2.3). */
export const RUNNER_PUBLISH_CHANNELS: ReadonlySet<string> = RUNNER_CHANNEL_KEYS;

/** 이 채널을 어떻게 발행하나. 아직 발행을 지원하지 않는 채널은 null(= reason "unsupported_channel"). */
export function publishViaOf(channel: string): PublishVia | null {
  return registryPublishViaOf(channel);
}

/* ─────────────────────────── 입력 ─────────────────────────── */

/**
 * 발행에 실리는 사진 한 장.
 *   🔴 `caption` 과 `alt` 는 **다른 것**이다(§5C · B-1 84a2372).
 *      · caption = 독자가 **보는** 한 줄. 글쓴이 말투 ≤25자이고 **대부분의 사진엔 없다**(다 달면 AI 티가 난다).
 *      · alt     = 화면에 **안 보이는** 접근성·검색용 설명. 그림 지시문(prompt)에서 짧게 파생한다.
 *      캡션이 «대부분 없다»로 바뀐 뒤로 alt 를 caption 으로 채우면 **alt 가 통째로 비어 버린다** —
 *      스크린리더 사용자에게는 사진이 사라지고, 이미지 검색에서도 빠진다. 그래서 칸을 나눠 받는다.
 */
/**
 * 발행에 실리는 사진 한 장.
 *   🔴 `source`·`stock` 은 **크레딧을 쓰기 위해** 여기까지 온다(2026-09-16 메인 · A 가 잡았다).
 *      `piece_assets.meta` 에 처음부터 있었는데 **발행 쪽이 읽지 않아** 스톡 작가·출처가 본문에 안 실렸다.
 *      `lib/stock/index.ts:22` 가 스스로 적어 뒀다 — «키가 죽는 진짜 경로는 **크레딧 미표기**».
 */
export interface PublishImage { url: string; caption?: string; alt?: string; sort?: number; source?: PhotoSource | null; stock?: StockMeta | null }

/**
 * publish() 가 받는 글 한 편. pieces 행 + piece_assets 를 합친 모양.
 *   bodyHtml = 발행 정본(renderBlocksHtml 결과 또는 사람이 고친 본문 · §4B class 계약).
 *   blocks = 러너가 에디터 실요소로 바꿀 재료(§4B ↔ 스마트에디터 변환).
 */
export interface PublishPiece {
  id: number;
  tenantId: number;
  channel: string;
  /** `pieces.kind` — `post`(글) \| `video`(영상). 🔴 **채널만으로는 못 가른다**: 스레드처럼
   *  글도 영상도 되는 채널이 있어서, 여기가 없으면 커넥터가 한쪽으로만 보낸다(P1R7 §2.3 에서 실제로 그랬다). */
  kind: string;
  accountId: number | null;
  slotId?: number;
  title: string;
  bodyHtml: string;
  blocks: Block[];
  images: PublishImage[];
  tags: string[];
  /** 고지 문구(없으면 null). bodyHtml 첫 요소 `<div class="disclosure">` 와 같은 문장. */
  disclosure: string | null;
  affiliate?: { provider: string; url: string; subId?: string };
  /**
   * [R9-9 · §5.1 고지 축 4행 중 마지막] **인스타 쇼핑 태그** — 사진 위에 상품을 붙이는 값.
   *   🔴 **유튜브 쇼핑 태그와 다르다**: 유튜브는 API 에 칸 자체가 없어 «우리가 못 단다»가 사실이지만
   *      인스타는 `POST /{ig-user}/media` 에 `product_tags` 가 **있다**(Instagram Shopping 승인 + 카탈로그 필요).
   *      ⇒ «없는 길»이 아니라 **«외부 선결조건»**이다 — 코드를 먼저 완성하고 «키 꽂으면 즉시»로 둔다(CLAUDE §8).
   *   🔴 우리 키로 **실호출해 본 적 없다**(2026-09-16 인스타 계정 0). 거부당하면 태그만 빼고 한 번 더 올리고
   *      **빠진 사실을 감사에 남긴다**(AC-9) — 유료 파트너십 라벨과 **같은 모양**이다.
   *   `x`·`y` 는 사진 위 좌표(0~1). 캐러셀이 아니라 **한 장짜리 사진**일 때만 좌표가 뜻이 있다.
   */
  productTags?: { productId: string; x?: number; y?: number }[];
  /** 예약 시각 ISO(러너 표시·블로거 published 용). */
  scheduledFor?: string;
  /** 멱등 판정 재료 — 하나라도 있으면 재발행 0. */
  externalUrl?: string;
  channelRef?: string;
  status: string;
}

/**
 * publish() 가 받는 계정. 🔴 자격 평문 없음(hasCreds 로만 안다).
 *   proxyUrl 은 **원문**(러너 잡 payload 로 내려간다) — 응답·로그에 그대로 실으면 안 된다(maskProxyUrl).
 */
export interface PublishAccount {
  id: number;
  tenantId: number;
  channel: string;
  handle: string;
  displayName?: string;
  status: string;
  browserProfileKey: string;
  proxyUrl?: string;
  dailyCap: number;
  minGapMin: number;
  postsToday: number;
  lastPostAt?: string;
  monetize?: Record<string, unknown>;
}

export interface PublishOpts {
  /** 슬롯에서 온 발행이면 슬롯 id(러너 잡·finalize 가 슬롯을 닫는다). piece.slotId 보다 우선. */
  slotId?: number;
  /** 누가 시켰나(감사). 기본 "cron". */
  actor?: "cron" | "user" | "ops";
  /** 게이트까지만 보고 원격 호출·잡 적재 0(검증·카나리). 반환 ok:true · via 판정 · dryRun:true. */
  dryRun?: boolean;
}

/* ─────────────────────────── 반환 ─────────────────────────── */

/**
 * 실패 사유 — B 가 슬롯 상태를 고르는 열쇠.
 *   gate                    → 슬롯 awaiting_manual + 알림(발행 금지 · §16B)
 *   no_account·no_creds·account_blocked·auth_failed·provider_not_configured → 슬롯 awaiting_manual + 계정 쪽 알림
 *   channel_error·network   → retriable:true · 다음 5분 틱에 재시도(attempts 는 B 가 센다)
 *   unsupported_channel·not_publishable·config → 슬롯 failed
 */
export type PublishFailReason =
  | "gate"
  | "no_account"
  | "no_creds"
  | "account_blocked"
  | "auth_failed"
  | "provider_not_configured"
  | "channel_error"
  | "network"
  /** P1R5 §2.3 — 릴스·스레드가 영상을 **아직 처리 중**(IN_PROGRESS). 실패가 아니라 «조금 뒤에 다시»다(retriable).
      creation_id 를 남겨 두므로 다음 시도는 컨테이너를 새로 만들지 않는다(중복 게시 0). */
  | "video_processing"
  | "unsupported_channel"
  | "not_publishable"
  | "config";

/** 러너 채널일 때 함께 주는 기기 상태 — B 는 이 값만 보고 awaiting_runner 를 판정한다(기기 조회 중복 0 · 계약 §1 publisher). */
export interface RunnerFleetState {
  /** 이 테넌트에 최근 5분 안에 응답한 기기가 있나. */
  online: boolean;
  /** 등록된 기기 수(0 이면 «러너를 연결해 주세요»). */
  devices: number;
  /** 가장 최근 응답 ISO(없으면 키 없음). */
  lastSeenAt?: string;
  /** 마지막 응답 이후 분(기기가 있을 때만). 30 이상이면 계약상 awaiting_runner 표기. */
  offlineMin?: number;
}

export type PublishOk = {
  ok: true;
  via: PublishVia;
  /** API 채널 성공 시 · 러너 채널은 발행 후 report 때 생긴다(그때는 키 없음). */
  externalUrl?: string;
  channelRef?: string;
  /** 러너 채널: 적재한 runner_jobs.id. */
  jobId?: number;
  /** 러너 채널: 기기 상태(awaiting_runner 판정용). */
  runner?: RunnerFleetState;
  /** 이미 발행돼 있어 아무것도 하지 않았다(멱등 · CLAUDE §4.7). */
  already?: true;
  /** dryRun 이었다(원격 호출·잡 적재 0). */
  dryRun?: true;
  /** API 채널 성공이면 finalizePublish 까지 끝났다는 표식 + 만들어진 posts 행. */
  finalized?: true;
  postId?: number;
};

export type PublishFail = {
  ok: false;
  reason: PublishFailReason;
  /** 다음 틱에 같은 호출을 다시 해도 되나. */
  retriable: boolean;
  /** 사람말 한 문장(알림·«해야 할 일» 문구로 그대로 쓴다). */
  error: string;
  /** 개발용 한 줄(로그·audit detail). 자격 평문 금지. */
  detail?: string;
  /** reason "gate" 일 때만 — 화면이 그대로 그린다(§4 GateReport 와 같은 모양). */
  gate?: GateReport;
};

export type PublishResult = PublishOk | PublishFail;

/* ─────────────────────────── finalize ─────────────────────────── */

export interface PostStats { views?: number; likes?: number; comments?: number; lastSyncAt?: string }

/** finalizePublish 입력 — «발행이 실제로 끝났다»는 사실 하나. */
export interface FinalizeInput {
  externalUrl?: string;
  channelRef?: string;
  /** DB 에 적히는 3값(`api|runner|manual`) — 커넥터 반환(2값)과 다르다. 사람이 직접 올린 건도 여기로 들어온다. */
  via: PublishedVia;
  /** 알면 준다(러너 report 는 job.account_id). 없으면 piece.account_id 를 쓴다. */
  accountId?: number;
  /** 발행 시각 ISO. 없으면 NOW(). */
  publishedAt?: string;
  /** 발행 직후 회수한 통계(보통 없음 · learn 스텝이 채운다). */
  stats?: PostStats;
  /** 알면 준다(스코프 재확인 · 조회 1회 절약). 주면 piece.tenant_id 와 다를 때 실패한다. */
  tenantId?: number;
}

export type FinalizeResult =
  | {
      ok: true;
      postId: number;
      pieceId: number;
      tenantId: number;
      /** 이미 발행돼 있었다 — 아무것도 바꾸지 않고 기존 post 를 돌려준다(멱등). */
      already: boolean;
      externalUrl?: string;
      channelRef?: string;
      slotId?: number;
      accountId?: number;
    }
  | { ok: false; reason: "not_found" | "no_url" | "tenant_mismatch" | "db"; error: string; detail?: string };

/* ─────────────────────────── 함수 시그니처(정본) ─────────────────────────── */

/** lib/publish/index.ts 의 정본 시그니처. */
export type PublishFn = (piece: PublishPiece, account: PublishAccount | null, opts?: PublishOpts) => Promise<PublishResult>;
/** lib/publish/finalize.ts 의 정본 시그니처. */
export type FinalizePublishFn = (pieceId: number, input: FinalizeInput) => Promise<FinalizeResult>;
