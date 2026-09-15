# B2 → B · `db/schema.ts` 블록 (P1R8 §3.3 recipe · DDL 0051)

> CLAUDE §4.4 — **B 만** `db/schema.ts` 를 만진다. DDL(`drizzle/0051-r8-recipe.sql`)은 **B2 가 라이브에 적용 완료**(10/10 · 2026-09-15).
> 🔴 §4.4 는 «schema.ts 정의는 **DDL 적용과 동시에**» 라고 한다 — 그래서 미루지 말고 이 블록을 그대로 붙여 주세요.
> 아래를 `db/schema.ts` **맨 끝**에 그대로 붙이면 됩니다(다른 라운드 정의는 건드리지 않습니다).

---

## 붙일 것

```ts
/* === Phase R8 §3.3 (B2 · drizzle/0051-r8-recipe.sql) === */

/**
 * [R8 §3.3 · B2 2026-09-15] 셀렉터 표(recipe) — 러너가 «무엇을 누를지»를 서버가 내려 준다.
 *   설계 `docs/active/2026-09-15-recipe-canary-design.md` · 코드 `lib/recipe.ts`·`lib/recipe-store.ts`.
 *   🔴 **한 번 올린 version 의 내용은 안 바꾼다** — «같은 버전인데 다른 표»가 돌면 사고 때 무엇이 돌았는지 영영 모른다
 *      (러너 zip 과 같은 규율). 그래서 version 이 PK 이고, 고칠 일이 있으면 **새 연번**을 만든다.
 *   `body` 는 서명(Ed25519)까지 붙은 채로 러너에 **그 값 그대로** 내려간다.
 */
export const recipes = pgTable("recipes", {
  version:    varchar("version", { length: 40 }).primaryKey(),   // tistory@2026-09-16.1 (사람이 입으로 말할 수 있는 이름)
  channel:    varchar("channel", { length: 24 }).notNull(),
  minRunner:  varchar("min_runner", { length: 20 }).notNull().default("0.0.0"),
  body:       jsonb("body").notNull(),
  rollbackTo: varchar("rollback_to", { length: 40 }),            // 🔴 만들 때 채운다(사고 한가운데서 찾는 건 제일 안 되는 일)
  note:       varchar("note", { length: 300 }),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ channelIdx: index("recipes_channel_idx").on(t.channel, t.createdAt) }));

/**
 * [R8 §3.3 · B2] 채널마다 «지금 퍼진 판»과 «시험 중인 판».
 *   🔴 `stage` = canary → own → volunteer → all. **넓히는 것은 KST 평일 10~18시에만, 좁히는 것은 언제나**
 *      (`lib/recipe.ts canPromoteAt`). 퍼센트가 아니라 **순서**인 이유: recipe 가 틀리면 우리 서버가 아니라
 *      **고객 블로그에 잘못된 글이 남는다** — 우리 기기가 먼저 맞아야 한다.
 *   `current_version` 이 NULL 이면 러너는 zip 에 묶여 온 표로 일한다(정상 동작이지 실패가 아니다).
 */
export const recipeRollouts = pgTable("recipe_rollouts", {
  channel:          varchar("channel", { length: 24 }).primaryKey(),
  currentVersion:   varchar("current_version", { length: 40 }),
  candidateVersion: varchar("candidate_version", { length: 40 }),
  stage:            varchar("stage", { length: 12 }).notNull().default("canary"),
  stageSince:       timestamp("stage_since").notNull().defaultNow(),
  promotedAt:       timestamp("promoted_at"),
  rolledBackAt:     timestamp("rolled_back_at"),
  rollbackReason:   varchar("rollback_reason", { length: 300 }),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

/** [R8 §3.3 · B2] 기존 표에 더한 칸 — 선언만(값은 B2 코드가 쓴다). */
export const canaryRunsR8 = {
  /** 이 카나리가 **어느 표를 시험했나**. 없으면 «오늘 통과했다»가 어느 판에 대한 말인지 모르는 말이 된다. */
  recipeVersion: "recipe_version",   // varchar(40)
  /** 그때의 배포 단계(canary|own|volunteer|all). */
  stage: "stage",                    // varchar(12)
} as const;

export const runnerJobsR8 = {
  /**
   * 🔴 이 잡이 **실제로 쓴 셀렉터 표**. NULL = 묶여 온 표로 돌았다.
   *   자동 복귀 판정의 **유일한 정직한 근거**다 — 이 칸이 없으면 «셀렉터가 깨졌다»는 실패를 보고도
   *   새 표 탓인지 옛 표 탓인지 구분할 수 없고, 그러면 멀쩡한 판을 되돌리거나 깨진 판을 안 되돌린다.
   */
  recipeVersion: "recipe_version",   // varchar(40) · index (recipe_version, status)
} as const;

export const tenantsR8Recipe = {
  /**
   * 🔴 «먼저 받아 볼래요» 옵트인 — **기본 꺼짐**. 옵트인 없이 고객을 카나리로 쓰지 않는다.
   *   AI 모델 카나리와 다른 점: 저쪽은 우리 서버 안에서 글자만 바뀌지만, recipe 는 **남의 계정에서 버튼을 누른다.**
   */
  recipeVolunteer: "recipe_volunteer",   // boolean NOT NULL DEFAULT false
} as const;
```

---

## 딸린 한 줄 — 🔴 **이건 B 가 판단할 것**

`tenants.recipe_volunteer` 를 **고객이 켜는 화면**은 아직 없습니다(설정 어딘가에 «새 기능 먼저 받아 볼래요» 한 줄).
지금 상태로도 안전합니다 — 아무도 안 켜면 자원자 0명이고, 그러면 배포가 **앞 단계를 두 배(48시간) 머물다** 전체로 갑니다
(설계 §4 «자원자가 0명이면 단계를 건너뛰지 않고 길게 잡는다»). 급하지 않지만 **있으면 배포가 하루 빨라집니다.**

## 참고 — 제가 같이 고친 것(`runner_devices.caps`)

`caps` 는 이미 `runnerDevicesR5` 에 선언돼 있습니다(칸 추가 없음). 다만 **서버가 그 값을 화면에 한 번도 안 보내고 있었고**
(`listDevices` 가 SELECT 를 안 했다) 이번에 이었습니다. `caps` 안에 `profileSeal` 이 하나 늘었습니다 — jsonb 안이라 DDL 은 없습니다.
