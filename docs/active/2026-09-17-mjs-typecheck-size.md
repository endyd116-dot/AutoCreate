# `scripts/**.mjs` 타입검사 — **크기부터 셌다** (R11-14 · B2 · 2026-09-17)

> 트리거: «🔴 **크기부터 세고 보고해라. 많으면 내가 나눈다. 혼자 다 고치지 마라.**»
> ⇒ **고치지 않았다.** 잰 것만 적는다. `tsconfig.json` 은 **안 건드렸다**(재는 동안만 임시 설정을 썼고 지웠다).

---

## 0. 지금의 사실

| | |
|---|---|
| 타입검사 안 | `netlify/functions/**.ts` · `lib/**.ts` · `db/**.ts` · **`scripts/**.mts`**(2026-09-16 에 넣었다) |
| 타입검사 **밖** | 🔴 **`scripts/**.mjs` 52개**(10,194줄) · 🔴 **`runner/**.mjs` 37개**(7,126줄 · `exclude` 에 `runner`) |
| 왜 밖인가 | `allowJs` 를 안 켰다. «전부 검사받는다»고 믿으면 안 된다 — **«`.mts` 는 재고 `.mjs` 는 안 잰다»가 사실이고 알고 두는 것**이다 |

---

## 1. 🔴 켜면 얼마나 나오나 — **두 숫자가 다르다**

`allowJs`+`checkJs` 를 켜고 `scripts/**/*.mjs` 를 `include` 에 넣어 **실제로 돌렸다**.

| 설정 | 오류 | 파일 | 무엇인가 |
|---|---:|---:|---|
| `checkJs` **그대로**(=`strict` 의 `noImplicitAny` 켜짐) | **1,699** | 63 | 🔴 **60%가 `TS7006`(«인자에 타입이 없다») 1,021건** — 잡음이다 |
| `checkJs` + 🔴 **`noImplicitAny: false`** | **292** | 45 | **이게 진짜 크기다** |

⇒ 🔴 **켠다면 `noImplicitAny:false` 로 켜야 한다.** 안 그러면 1,021건의 «타입을 적어라»가 신호를 덮는다.
   («인자 타입을 적는 것»은 그 자체로 값이 있지만 **이번 라운드의 값이 아니다** — 우리가 찾는 것은 `verify-b4-place.mts` 같은 **틀린 조합**이다.)

### 1.1 진짜 크기(292건)의 속 — 🔴 **이 표의 위 넷이 «틀린 값을 초록으로 찍는» 종류다**

| 코드 | 건수 | 뜻 | 왜 위험한가 |
|---|---:|---|---|
| `TS2339` | 131 | 없는 속성을 읽는다 | 🔴 `undefined` 를 «통과»로 읽는 축이 여기서 나온다 |
| `TS2345` | 52 | **인자 타입이 어긋난다** | 🔴 **`verify-b4-place.mts` 와 같은 병** — 있지도 않은 조합을 초록으로 잰다 |
| `TS2488`/`TS2769`/`TS2353` | 45 | 이터러블 아님 · 맞는 오버로드 없음 · **없는 키를 적는다** | 🔴 «적었는데 아무도 안 읽는 칸» |
| `TS18046/7/8` | 48 | `unknown`·`null` 가능성 | 대개 잡음(단언 한 줄) |

### 1.2 파일 상위 — 🔴 **나눌 때 이 순서로**

| 오류 | 파일 | 누구 것인가 |
|---:|---|---|
| 21 | `scripts/verify-r9-bleed-browser.mjs` | **B2**(번짐 자) |
| 20 | `scripts/verify-p1r5.mjs` | 옛 라운드 자 |
| 16 | `scripts/verify-p1r7.mjs` | 옛 라운드 자 |
| 14 | `runner/lib/profile-seal.mjs` | **B2** |
| 13 | `scripts/verify-p1r6.mjs` · `scripts/verify-profile-seal.mjs` | 옛 라운드 / **B2** |
| 12 | `scripts/verify-p1r1.mjs` | 옛 라운드 자 |
| 11 | `scripts/seed-bgm.mjs` · `scripts/verify-r8-live-readonly.mjs` | |
| 10 | `runner/channels/render-video.mjs` · `scripts/shot-p1r1.mjs` · `scripts/verify-r6-5.mjs` · `scripts/verify-r9-screen-browser.mjs` | **B2** |

---

## 2. 🔴 세면서 **눈에 걸린 것 하나** — 옮겨 적는다(안 고쳤다)

`runner/lib/profile-seal.mjs` 에서 **`TS2353`(없는 키를 적는다)** 이 세 줄 나왔다:

```
profile-seal.mjs(93,47):  'exists' does not exist in type '{ platform; v10; v11; read }'
profile-seal.mjs(107,37): 'sealed' does not exist in type '{ platform; profiles; state; copySafe; why; weak; unknown }'
profile-seal.mjs(125,45): 'sealed' does not exist in type '{ ... }'
```

⇒ **같은 함수가 갈래마다 다른 모양을 돌려준다.** 읽는 쪽이 `.sealed` 를 보는 갈래가 있으면 어떤 경로에서는 **늘 `undefined`** 다.
🔴 이건 «타입을 안 적었다»가 아니라 «**칸이 서로 다르다**»라 **AC-56(«가운데만 없다»)의 모양**이다 — 양끝은 `grep` 으로 다 나온다.
**고치지 않았다**(트리거 지시). 프로필 봉인은 아직 본체가 안 만들어진 영역이라(인수인계 §5B) 같이 볼 자리다.

---

## 3. 제안 — 🔴 **메인이 나눌 때 쓰라고 적는다**

1. **단계 ①(싸다 · 한 창)**: `tsconfig` 에 `allowJs`+`checkJs`+`noImplicitAny:false` 를 켜되 `include` 는 **`scripts/**.mjs` 만**.
   `runner/**` 는 `exclude` 라 그대로 밖이다 — 한 번에 둘을 켜면 292 가 아니라 더 큰 수가 된다.
2. **단계 ②**: 🔴 **`TS2345`(52건)를 맨 먼저** 본다. «있지도 않은 조합을 초록으로 재던» 하니스가 여기 있다.
3. **단계 ③**: `TS2339`·`TS2353` 은 파일 단위로 나눈다(위 표 순서).
4. 🔴 **옛 라운드 자(`verify-p1r1`·`p1r5`·`p1r6`·`p1r7`)는 «고칠 것»이 아니라 «아직 쓰나»를 먼저 물어야 한다** —
   안 쓰는 자를 고치는 데 시간을 쓰면 그게 제일 비싸다.

---

## 4. 재현

```
# 임시 설정으로 재고, 재고 나서 **지운다**(tsconfig.json 은 안 건드린다)
python - <<'EOF'
import io, json
c = json.load(io.open("tsconfig.json", encoding="utf-8"))
c["compilerOptions"]["allowJs"] = True
c["compilerOptions"]["checkJs"] = True
c["compilerOptions"]["noImplicitAny"] = False
c["include"] = c["include"] + ["scripts/**/*.mjs"]
io.open("tsconfig.mjscount.json","w",encoding="utf-8",newline="\n").write(json.dumps(c, ensure_ascii=False, indent=2))
EOF
npx tsc --noEmit -p tsconfig.mjscount.json > /tmp/mjs.txt 2>&1; echo $?
rm tsconfig.mjscount.json
```
