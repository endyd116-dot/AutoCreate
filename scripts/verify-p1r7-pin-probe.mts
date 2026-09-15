/**
 * scripts/verify-p1r7-pin-probe.mts — **AC-53 안전핀 음성 대조**(C · R7 §5-④).
 *   `npx tsx scripts/verify-p1r7-pin-probe.mts`   (.env 를 읽지 않는다 — 환경을 내가 만든다)
 *   재는 것: `netlify dev` 안(`NETLIFY_DEV=true`)인데 주소가 **라이브**면 `backgroundBase()` 가 **던지는가**.
 *   🔴 음성 대조가 핵심이다 — «안 던진다» 를 확인하는 검사는 안전핀이 빠져도 초록이다.
 */
const out = (step: string, ok: boolean, note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const LIVE = "https://autocreate-endyd.netlify.app";

for (const k of ["URL", "DEPLOY_PRIME_URL", "SITE_URL", "NETLIFY_DEV"]) delete process.env[k];
const { backgroundBase, publicBase, isNetlifyDev } = await import("../lib/site-url");

// ① netlify dev + 라이브 주소 → 던져야 한다
process.env.NETLIFY_DEV = "true"; process.env.SITE_URL = LIVE;
let threw = "", got = "";
try { got = backgroundBase(); } catch (e) { threw = String((e as Error)?.message ?? e); }
out("🔴 ④ netlify dev 인데 라이브 주소 → **던진다**(조용히 라이브 배경 함수를 부르는 길 0)", !!threw && /로컬|멈췄|라이브/.test(threw), threw ? `«${threw.slice(0, 60)}»` : `🔴 안 던지고 «${got}» 를 돌려줬다`);

// ② netlify dev + 로컬 주소 → 통과(양성 대조 — 안전핀이 로컬까지 막으면 개발이 멈춘다)
process.env.SITE_URL = "http://localhost:8901";
let ok2 = "", err2 = "";
try { ok2 = backgroundBase(); } catch (e) { err2 = String((e as Error)?.message ?? e); }
out("④ netlify dev + 로컬 주소 → 통과(양성 대조)", ok2 === "http://localhost:8901" && !err2, err2 ? `🔴 던졌다 «${err2.slice(0, 50)}»` : ok2);

// ③ 라이브(NETLIFY_DEV 없음) + 라이브 주소 → 통과
delete process.env.NETLIFY_DEV; process.env.URL = LIVE;
let ok3 = "", err3 = "";
try { ok3 = backgroundBase(); } catch (e) { err3 = String((e as Error)?.message ?? e); }
out("④ 라이브에서는 라이브 주소로 통과(안전핀이 프로덕션을 막지 않는다)", ok3 === LIVE && !err3, err3 ? `🔴 던졌다` : ok3);
out("④ isNetlifyDev 는 환경 그대로 읽는다", isNetlifyDev() === false, `NETLIFY_DEV 없음 → ${isNetlifyDev()}`);

// ④ publicBase 는 **던지지 않는다**(안내문이 빈칸이 되는 것보다 정본 주소가 낫다)
process.env.NETLIFY_DEV = "true"; delete process.env.URL; delete process.env.SITE_URL;
let pb = "", perr = "";
try { pb = publicBase(); } catch (e) { perr = String((e as Error)?.message ?? e); }
out("④ publicBase 는 던지지 않는다(사람에게 남는 주소는 빈칸보다 정본이 낫다)", !perr && !!pb, perr ? `🔴 던졌다` : pb);
process.exit(0);
