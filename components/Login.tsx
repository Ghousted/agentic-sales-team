"use client";
// Sign-in / sign-up / forgot-password, styled after the redesign's auth screen:
// a blue dot-grid backdrop with a frosted-glass frame around a white card.
// Auth itself is the app's own email + password flow (lib/auth/actions).
import { useState } from "react";
import { useApp } from "@/lib/store";
import { signIn, signUp, requestPasswordReset } from "@/lib/auth/actions";
import { css } from "./primitives";
import { SIGNUP_EMAIL_KEY } from "./landing/LandingPage";

const INPUT = "height:52px;padding:0 16px;border:1px solid #dfe3e9;border-radius:14px;font-size:16px;background:#ffffff;color:#101418;transition:border-color .15s,box-shadow .15s;outline:none;width:100%";
const LABEL = "font-size:15px;font-weight:500;color:#101418";
const STR_COL = ["#e3e7ed", "#b42318", "#d98e00", "#0b57d0", "#0f7b3f"];

function strength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/i.test(pw) && /\d/.test(pw)) s++;
  if (/[^a-z0-9]/i.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) s++;
  return Math.max(1, Math.min(4, s));
}

function Field({ label, children, extra }: { label: React.ReactNode; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <label style={css("display:flex;flex-direction:column;gap:6px")}>
      <span style={css(LABEL + ";display:flex;justify-content:space-between;align-items:baseline")}>{label}</span>
      {children}
      {extra}
    </label>
  );
}

export default function Login() {
  const { s, set } = useApp();
  const isSignup = s.authMode === "signup";
  // Prefill from the landing hero's "Work email" field, if the visitor typed one.
  const [email, setEmail] = useState(() => {
    try { const v = sessionStorage.getItem(SIGNUP_EMAIL_KEY) ?? ""; sessionStorage.removeItem(SIGNUP_EMAIL_KEY); return v; } catch { return ""; }
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [errKey, setErrKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [swap, setSwap] = useState(0);

  // Forgot-password sub-flow. Self-serve reset is off until the app can email a link.
  const [forgot, setForgot] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const fail = (msg: string) => { setError(msg); setErrKey((k) => k + 1); };
  const openForgot = (e: React.MouseEvent) => { e.preventDefault(); setError(""); setResetDone(false); setForgot(true); setSwap((n) => n + 1); };
  const closeForgot = () => { setError(""); setForgot(false); setSwap((n) => n + 1); };
  const switchMode = () => { setError(""); setSwap((n) => n + 1); set({ authMode: isSignup ? "login" : "signup" }); };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    const res = await requestPasswordReset({ email });
    setLoading(false);
    if (!res.ok) return fail(res.error || "Something went wrong. Please try again.");
    setResetDone(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || ok) return;
    setError("");
    setLoading(true);
    const res = isSignup ? await signUp({ email, password, name: name.trim() || undefined }) : await signIn({ email, password });
    setLoading(false);
    if (!res.ok || !res.user) return fail(res.error || "Something went wrong. Please try again.");
    setOk(true);
    // Full navigation so the server re-hydrates THIS user's workspace and nothing
    // from a prior session lingers in the client store.
    window.setTimeout(() => { window.location.href = "/"; }, 350);
  };

  const sc = isSignup ? strength(password) : 0;
  const title = forgot ? "Reset your password" : isSignup ? "Create your account" : "Welcome back";
  const sub = forgot ? "Enter your work email and we’ll tell you how to get back in." : isSignup ? "Set up your workspace and meet your first agent in a few minutes." : "Log in to see what your agents did while you were away.";
  const cta = ok ? (isSignup ? "Account created" : "Logged in") : loading ? (isSignup ? "Creating account…" : "Logging in…") : isSignup ? "Create account" : "Log in";
  const focus = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = "#006aff"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(0,106,255,.14)"; };
  const blur = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = "#dfe3e9"; e.currentTarget.style.boxShadow = "none"; };

  const errorBox = error && (
    <div key={errKey} role="alert" style={css("padding:10px 12px;border-radius:10px;background:#fdf2f2;color:#9b1c1c;font-size:14px;display:flex;align-items:center;gap:8px;animation:cShake .3s ease-out")}>
      <i className="icon-circle-alert" style={{ fontSize: 16, flex: "none" }} />{error}
    </div>
  );
  const primary = (label: React.ReactNode, busy: boolean, done = false) => (
    <button type="submit" style={{ ...css("margin-top:14px;height:52px;border:0;border-radius:14px;box-shadow:0 8px 20px -10px rgba(0,106,255,.6);color:#ffffff;font-size:15px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:background .2s,transform .1s"), background: done ? "#0f7b3f" : "#006aff" }}>
      {busy && <span style={css("width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#ffffff;animation:cSpin .8s linear infinite")} />}
      {done && <i className="icon-check" style={{ fontSize: 18, animation: "cCheck .2s ease-out backwards" }} />}
      {label}
    </button>
  );

  return (
    <div style={css("position:fixed;inset:0;z-index:60;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',system-ui,sans-serif;color:#101418;-webkit-font-smoothing:antialiased")}>
      <div style={css("position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:96px 20px 48px;background:linear-gradient(180deg,#0047b3 0%,#0058e6 30%,#006aff 55%,#4b92ff 82%,#6ea8ff 100%);overflow:hidden;animation:cFade .35s ease-out backwards")}>
        <span aria-hidden="true" style={css("position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.26) 1px,transparent 1.5px);background-size:22px 22px")} />
        <button type="button" onClick={() => set({ showAuth: false })} aria-label="Back to home" style={css("position:absolute;left:28px;top:24px;display:flex;align-items:center;gap:8px;height:36px;padding:0 14px 0 10px;border-radius:999px;color:#ffffff;font-size:14px;font-weight:500;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);cursor:pointer;transition:background .15s")}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.12)"; }}>
          <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7M19 12H5" /></svg>Home
        </button>

        <div style={css("position:relative;width:100%;max-width:520px;padding:14px;border-radius:40px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.32);box-shadow:0 40px 90px -40px rgba(0,30,90,.6),inset 0 1px 0 rgba(255,255,255,.25);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:cPop .45s cubic-bezier(.2,.8,.2,1) backwards")}>
          <div style={css("padding:44px 40px 32px;border-radius:28px;background:#ffffff;box-shadow:0 2px 8px rgba(0,30,90,.08)")}>
            <div key={swap + (isSignup ? "s" : "l")} style={css("width:100%;animation:" + (swap % 2 ? "cSwapA" : "cSwapB") + " .22s ease-out backwards")}>
              <div style={css("display:flex;flex-direction:column;align-items:center;text-align:center")}>
                <span style={css("width:52px;height:52px;border-radius:14px;background:url('/logo-mark.png') center/cover no-repeat;box-shadow:0 8px 20px -8px rgba(0,82,204,.6)")} />
                <h1 style={css("margin:22px 0 0;font-family:'General Sans',system-ui,sans-serif;font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-.03em")}>{title}</h1>
                <p style={css("margin:10px 0 0;font-size:16px;line-height:1.5;color:#4a5565")}>{sub}</p>
              </div>

              {forgot ? (
                <form onSubmit={sendReset} noValidate style={css("margin-top:28px;display:flex;flex-direction:column;gap:16px")}>
                  {resetDone ? (
                    <div style={css("padding:14px;border-radius:12px;background:#f2f7ff;font-size:14.5px;line-height:1.55;color:#2a313b;animation:cUp .2s ease-out backwards")}>
                      Self-serve password reset isn’t available yet. If an account exists for that email, contact support and we’ll reset it for you.
                    </div>
                  ) : (
                    <>
                      <Field label="Work email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onFocus={focus} onBlur={blur} autoComplete="email" placeholder="you@company.com" style={css(INPUT)} /></Field>
                      {errorBox}
                      {primary(loading ? "Checking…" : "Continue", loading)}
                    </>
                  )}
                  <p style={css("margin:10px 0 0;font-size:15px;color:#4a5565;text-align:center")}>
                    <button type="button" onClick={closeForgot} style={css("border:0;background:transparent;padding:0;color:#006aff;font-size:15px;font-weight:600;cursor:pointer")}>Back to log in</button>
                  </p>
                </form>
              ) : (
                <>
                  <form onSubmit={submit} noValidate style={css("margin-top:28px;display:flex;flex-direction:column;gap:16px")}>
                    {isSignup && (
                      <div style={css("animation:cUp .2s ease-out backwards")}>
                        <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} onFocus={focus} onBlur={blur} autoComplete="name" placeholder="Alex Rivera" style={css(INPUT)} /></Field>
                      </div>
                    )}
                    <Field label="Work email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onFocus={focus} onBlur={blur} autoComplete="email" placeholder="you@company.com" style={css(INPUT)} /></Field>
                    <Field
                      label={<>Password{!isSignup && <a href="#" onClick={openForgot} style={css("font-weight:400;font-size:14.5px;color:#006aff;text-decoration:none")}>Forgot password?</a>}</>}
                      extra={isSignup && (<>
                        <span style={css("display:flex;gap:4px;margin-top:2px")}>{[1, 2, 3, 4].map((i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: sc >= i ? STR_COL[sc] : "#e3e7ed", transition: "background .2s" }} />)}</span>
                        <span style={{ fontSize: 13, color: password ? STR_COL[sc] : "#8a94a3", transition: "color .2s" }}>{password ? ["", "Weak", "Okay", "Good", "Strong"][sc] + " password" : "Use 8 or more characters with a mix of letters and numbers."}</span>
                      </>)}
                    >
                      <span style={css("position:relative;display:flex")}>
                        <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onFocus={focus} onBlur={blur} autoComplete={isSignup ? "new-password" : "current-password"} placeholder={isSignup ? "Create a password" : "Your password"} style={css(INPUT + ";padding-right:48px")} />
                        <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} style={css("position:absolute;right:8px;top:10px;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:#6b7686;display:flex;align-items:center;justify-content:center;cursor:pointer")}>
                          <i className={showPw ? "icon-eye-off" : "icon-eye"} style={{ fontSize: 17 }} />
                        </button>
                      </span>
                    </Field>
                    {errorBox}
                    {primary(cta, loading, ok)}
                  </form>
                  <p style={css("margin:26px 0 0;font-size:15px;color:#4a5565;text-align:center")}>
                    {isSignup ? "Already have an account?" : "New to Agentic Sales Team?"}{" "}
                    <button type="button" onClick={switchMode} style={css("border:0;background:transparent;padding:0;color:#006aff;font-size:15px;font-weight:600;cursor:pointer")}>{isSignup ? "Log in" : "Create an account"}</button>
                  </p>
                  {isSignup && <p style={css("margin:12px 0 0;font-size:13px;line-height:1.5;color:#8a94a3;text-align:center")}>By creating an account you agree to the Terms and Privacy Policy.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
