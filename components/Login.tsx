"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { signIn, signUp, requestPasswordReset } from "@/lib/auth/actions";
import { css, Box, Btn } from "./primitives";
import Constellation from "./Constellation";

/* Eye / eye-off icon (mdi) for the password reveal toggle. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#717680" aria-hidden="true" style={{ display: "block" }}>
      {off ? (
        <path d="M11.83 9 15 12.16V12a3 3 0 0 0-3-3zM7.53 9.8l1.55 1.55c-.05.21-.08.42-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53a5 5 0 0 1-5-5c0-.79.2-1.53.53-2.2M2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3zM12 7a5 5 0 0 1 5 5c0 .64-.13 1.26-.36 1.82l2.93 2.93c1.5-1.25 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7" />
      ) : (
        <path d="M12 9a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3m0 8a5 5 0 0 1-5-5 5 5 0 0 1 5-5 5 5 0 0 1 5 5 5 5 0 0 1-5 5m0-12.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5" />
      )}
    </svg>
  );
}

const LABEL = "font-size:14px;font-weight:500;color:#414651;line-height:20px";
const FIELD_WRAP = "background:#fff;border:1px solid #e4e4e4;border-radius:12px;display:flex;align-items:center;gap:8px;padding:0 16px;height:52px;width:100%";
const FIELD_INPUT = "flex:1;border:none;outline:none;background:transparent;font-size:14px;color:#181d27;min-width:0";

function Field({ id, label, placeholder, password, value, setValue, onEnter }: {
  id: string; label: string; placeholder: string; password?: boolean; value: string; setValue: (v: string) => void; onEnter?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={css("display:flex;flex-direction:column;gap:6px;width:100%")}>
      <label htmlFor={id} style={css(LABEL)}>{label}</label>
      <div style={css(FIELD_WRAP)}>
        <input
          id={id}
          type={password && !show ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
          placeholder={placeholder}
          aria-label={label}
          style={css(FIELD_INPUT + ";color:#181d27")}
        />
        {password && (
          <Box as="span" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} style="display:flex;cursor:pointer">
            <EyeIcon off={show} />
          </Box>
        )}
      </div>
    </div>
  );
}

export default function Login() {
  const { s, set } = useApp();
  const router = useRouter();
  const isSignup = s.authMode === "signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Forgot-password sub-flow (no email infra: surface the reset link on-screen).
  const [forgot, setForgot] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [resetPath, setResetPath] = useState<string | null>(null);

  const openForgot = () => { setError(""); setResetDone(false); setResetPath(null); setForgot(true); };
  const closeForgot = () => { setError(""); setForgot(false); };

  const sendReset = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    const res = await requestPasswordReset({ email });
    setLoading(false);
    if (!res.ok) { setError(res.error || "Something went wrong. Please try again."); return; }
    setResetPath(res.resetPath ?? null);
    setResetDone(true);
  };

  const submit = async () => {
    if (loading) return;
    setError("");
    if (isSignup && password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }
    setLoading(true);
    const res = isSignup ? await signUp({ email, password }) : await signIn({ email, password });
    setLoading(false);
    if (!res.ok || !res.user) {
      setError(res.error || "Something went wrong. Please try again.");
      return;
    }
    // Full navigation (not router.push) so the server re-hydrates THIS user's
    // own workspace and no agents/teams/chats from a prior session linger in
    // the client store. The session cookie is already set by the action above.
    window.location.href = "/";
  };

  const switchMode = () => {
    setError("");
    set({ authMode: isSignup ? "login" : "signup" });
  };

  return (
    <div style={css("position:fixed;left:0;top:0;right:0;bottom:0;background:#fff;z-index:60;display:flex;animation:fadeUp .3s ease")}>
      {/* ===== left visual panel — continues the landing's constellation ===== */}
      <div style={css("position:relative;width:53%;min-width:520px;flex:none;background:radial-gradient(900px 720px at 62% 26%,#2A1657,#150B33 74%);border-radius:0 40px 40px 0;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px 48px")}>
        <div aria-hidden="true" style={{ position: "absolute", width: "420px", height: "420px", borderRadius: "50%", background: "#7C3AED", filter: "blur(80px)", opacity: 0.4, top: "-90px", right: "4%", pointerEvents: "none" }} />
        <div style={css("position:absolute;top:28px;left:32px;z-index:2;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:15px;font-weight:700;letter-spacing:-.01em;color:#fff")}>
          <span style={{ color: "#C9B8F5" }}>agentic</span> salesforce
        </div>
        <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "440px" }}>
          <Constellation />
        </div>
        <div style={css("position:relative;z-index:2;text-align:center;margin-top:6px;max-width:400px")}>
          <div style={css("font-family:'Poetsen One',sans-serif;font-size:26px;color:#fff;line-height:1.15;letter-spacing:-.01em")}>A sales team that runs itself.</div>
          <div style={css("font-size:14px;color:#B9AEE0;margin-top:10px;line-height:1.55")}>Your AI workforce finds, writes, and books — around the clock.</div>
        </div>
      </div>

      {/* ===== right form panel ===== */}
      <div style={css("position:relative;flex:1;min-width:0;display:flex;align-items:center;justify-content:center;padding:80px 64px;overflow-y:auto")}>
        <Box as="span" onClick={() => set({ showAuth: false })} aria-label="Back to home" style="position:absolute;top:28px;left:28px;display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;color:#717680;cursor:pointer" styleHover="color:#5122c1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          Home
        </Box>
        <div style={css("width:100%;max-width:476px;display:flex;flex-direction:column;gap:32px")}>
          {/* header */}
          <div style={css("display:flex;flex-direction:column;gap:24px;align-items:center")}>
            <div style={css("font-family:'JetBrains Mono',ui-monospace,monospace;font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-.02em;color:#181d27;text-align:center")}>
              <span style={{ color: "#5122C1" }}>agentic</span>
              <br />
              salesforce
            </div>
            <div style={css("display:flex;flex-direction:column;gap:12px;text-align:center;width:100%")}>
              <div style={css("font-size:30px;font-weight:700;line-height:38px;color:#181d27;letter-spacing:-.01em")}>
                {forgot ? "Reset your password" : isSignup ? "Sign up and create an account" : "Log in to your account"}
              </div>
              <div style={css("font-size:16px;color:#535862;line-height:24px")}>{forgot ? "Enter your email and we’ll get you a reset link." : "Welcome back! Please enter your details."}</div>
            </div>
          </div>

          {/* ===== forgot-password view ===== */}
          {forgot && (
            <div style={css("display:flex;flex-direction:column;gap:24px;width:100%")}>
              {resetDone ? (
                <div style={css("display:flex;flex-direction:column;gap:16px;width:100%")}>
                  {resetPath ? (
                    <>
                      <div style={css("font-size:13px;color:#3F3F46;background:#F1EDFD;border:1px solid #E3DBF9;border-radius:12px;padding:14px 16px;line-height:1.55")}>
                        No email server is configured in this demo, so use the link below to set a new password (valid for 1 hour):
                      </div>
                      <Btn onClick={() => { router.push(resetPath); router.refresh(); }} style="background:#5122c1;color:#fff;border:none;border-radius:100px;padding:12px 16px;width:100%;font-size:16px;font-weight:600;box-shadow:0 2px 8px rgba(81,34,193,.3);cursor:pointer" styleHover="background:#42199E">Reset your password →</Btn>
                    </>
                  ) : (
                    <div style={css("font-size:14px;color:#3F3F46;background:#F4F4F5;border:1px solid #E4E4E7;border-radius:12px;padding:14px 16px;line-height:1.55")}>
                      If an account exists for <strong>{email}</strong>, a reset link has been generated.
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Field id="reset-email" label="Email" placeholder="Enter your account email" value={email} setValue={setEmail} onEnter={sendReset} />
                  {error && (
                    <div role="alert" style={css("font-size:13px;color:#B91C1C;background:#FEECEC;border:1px solid #FBD5D5;border-radius:10px;padding:10px 14px")}>{error}</div>
                  )}
                  <Btn onClick={sendReset} disabled={loading} style={"background:#5122c1;color:#fff;border:none;border-radius:100px;padding:12px 16px;width:100%;font-size:16px;font-weight:600;box-shadow:0 2px 8px rgba(81,34,193,.3);" + (loading ? "opacity:.7;cursor:default" : "cursor:pointer")} styleHover={loading ? "" : "background:#42199E"}>
                    {loading ? "Generating link…" : "Send reset link"}
                  </Btn>
                </>
              )}
              <div style={css("display:flex;justify-content:center;width:100%")}>
                <Box as="span" onClick={closeForgot} style="font-size:14px;font-weight:600;color:#5122c1;cursor:pointer">← Back to login</Box>
              </div>
            </div>
          )}

          {/* form + submit */}
          {!forgot && (
          <div style={css("display:flex;flex-direction:column;gap:24px;width:100%")}>
            <div style={css("display:flex;flex-direction:column;gap:20px;width:100%")}>
              <Field id="email" label="Email" placeholder="Enter email" value={email} setValue={setEmail} onEnter={submit} />
              <Field id="password" label="Password" placeholder="Enter password" password value={password} setValue={setPassword} onEnter={submit} />
              {isSignup && <Field id="confirm" label="Confirm password" placeholder="Confirm password" password value={confirm} setValue={setConfirm} onEnter={submit} />}

              {error && (
                <div role="alert" style={css("font-size:13px;color:#B91C1C;background:#FEECEC;border:1px solid #FBD5D5;border-radius:10px;padding:10px 14px")}>{error}</div>
              )}

              <div style={css("display:flex;align-items:center;justify-content:space-between;width:100%")}>
                <div
                  role="checkbox"
                  aria-checked={remember}
                  aria-label="Remember for 30 days"
                  tabIndex={0}
                  onClick={() => setRemember((v) => !v)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRemember((v) => !v); } }}
                  style={css("display:flex;align-items:center;gap:8px;cursor:pointer")}
                >
                  <span style={css("width:16px;height:16px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex:none;transition:all .12s;border:1px solid " + (remember ? "#5122c1" : "#e4e4e4") + ";background:" + (remember ? "#5122c1" : "#fff"))}>
                    {remember && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                    )}
                  </span>
                  <span style={css("font-size:14px;font-weight:500;color:#414651;white-space:nowrap")}>Remember for 30 days</span>
                </div>
                <Box as="span" onClick={openForgot} style="font-size:14px;font-weight:600;color:#5122c1;cursor:pointer;white-space:nowrap">Forgot password?</Box>
              </div>
            </div>

            <Btn onClick={submit} disabled={loading} style={"background:#5122c1;color:#fff;border:none;border-radius:100px;padding:12px 16px;width:100%;font-size:16px;font-weight:600;letter-spacing:-.15px;box-shadow:0 2px 8px rgba(81,34,193,.3);" + (loading ? "opacity:.7;cursor:default" : "cursor:pointer")} styleHover={loading ? "" : "background:#42199E"}>
              {loading ? (isSignup ? "Creating account…" : "Signing in…") : isSignup ? "Create account" : "Sign In"}
            </Btn>
          </div>
          )}

          {/* toggle row */}
          {!forgot && (
          <div style={css("display:flex;gap:4px;align-items:center;justify-content:center;width:100%")}>
            <span style={css("font-size:14px;color:#535862")}>{isSignup ? "Already have an account?" : "Don’t have an account?"}</span>
            <Box as="span" onClick={switchMode} style="font-size:14px;font-weight:600;color:#5122c1;cursor:pointer">
              {isSignup ? "Log in" : "Sign up"}
            </Box>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
