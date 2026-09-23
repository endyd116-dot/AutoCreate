# B2 → B · `db/schema.ts` 한 줄 (R17 클립 모집창 · DDL `0092`)

> CLAUDE §4.4 — **B 만** `db/schema.ts` 를 만진다. DDL(`drizzle/0092-r17-channel-monetize-meta.sql`)은
> **B2 가 라이브에 적용 완료**(2026-09-23 · `applied 2 / total 2` · `jsonb_typeof(monetize_meta)=object` 실측).
> 🔴 §4.4 는 «schema.ts 정의는 **DDL 적용과 동시에**» 라고 한다 — 그래서 미루지 말고 이 한 줄을 붙여 주세요.

---

## 붙일 것 — 기존 `channelRegistry`(`db/schema.ts:201`) 안에 **한 줄**

```ts
export const channelRegistry = pgTable("channel_registry", {
  key:        varchar("key", { length: 24 }).primaryKey(),
  label:      varchar("label", { length: 40 }).notNull(),
  category:   varchar("category", { length: 10 }).notNull(),
  publishVia: varchar("publish_via", { length: 10 }).notNull(),
  status:     varchar("status", { length: 12 }).notNull().default("planned"),
  bestHours:  jsonb("best_hours").notNull().default([]),
  monetize:   jsonb("monetize").notNull().default([]),
  /* [R17-B2 · drizzle/0092] 운영자가 손으로 넣는 «수익 관련 사실» — 지금은 clipOpen:{from,to}(클립 모집창 · KST 날짜).
     🔴 위 `monetize`(배열 = 수익 매체 **목록**)와 **다른 칸**이다. 한 칸에 섞으면 목록을 저장할 때마다 모집창이 사라진다
        — 실제로 9일 동안 그 모양이었다(R16 실측 · `monetize->'clipOpen'` 이 배열이라 언제나 NULL). */
  monetizeMeta: jsonb("monetize_meta").notNull().default({}),
  sort:       integer("sort").notNull().default(0),
});
```

🔴 **`monetize` 는 건드리지 마세요** — 배열 그대로가 정본이고, 운영 화면의 «수익 매체» 칩이 그 뜻으로 씁니다.

## 왜 새 칸인가 (한 줄)

`lib/ad-eligibility.ts` 가 `monetize->'clipOpen'` 을 **객체**로 읽는데 그 칸은 `0001-init.sql:208` 부터 **배열**이었고,
`ops-channels.ts` 가 칩 저장 때마다 그 칸을 배열로 **통째 덮어썼다.** ⇒ D-7 «클립 모집이 시작해요» 알림이
**구조적으로 한 번도 못 떴다.** 🔴 **오류는 0이라 아무도 몰랐다.**

## 이미 붙어 있는 것(B 가 할 일은 위 한 줄뿐)

| 무엇 | 어디 |
|---|---|
| DDL(적용 완료) | `drizzle/0092-r17-channel-monetize-meta.sql` |
| 읽는 쪽 | `lib/ad-eligibility.ts clipWindow()` — `monetize_meta->'clipOpen'` |
| 쓰는 쪽(서버) | `netlify/functions/ops-channels.ts` — GET `clipOpen`·`clipNoticeDays` · POST `clipOpen:{from,to}|null` · 감사 detail |
| 쓰는 쪽(화면) | `public/ops/channels.html` — 목록 «모집창(KST)» 칸 + 편집 시트 날짜 둘 |
| 자 | `scripts/verify-clip-window.mts` — 라이브 왕복(넣기→읽기→지우기→되돌리기 · 🔴 **스스로 치운다**) |

🔴 그 자는 **변이로 확인했다**: `clipWindow()` 를 옛 `monetize->'clipOpen'` 으로 되돌리면 **빨강 + 종료코드 1**,
되돌리면 초록 + 0. 초록이 증거가 되게 해 뒀다.
