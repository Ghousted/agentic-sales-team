"use client";
// Password-reset landing page, reached from the link surfaced by "Forgot
// password?". Validates the token, then lets the user set a new password.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { validateResetToken, resetPassword } from "@/lib/auth/actions";
import { css, Box, Btn } from "@/components/primitives";

const FIELD_WRAP = "background:#fff;border:1px solid #e4e4e4;border-radius:12px;display:flex;align-items:center;gap:8px;padding:0 16px;height:52px;width:100%";
const FIELD_INPUT = "flex:1;border:none;outline:none;background:transparent;font-size:14px;color:#181d27;min-width:0";
const LABEL = "font-size:14px;font-weight:500;color:#414651;line-height:20px";

function Wordmark() {
  return (
    <div style={css("font-family:'JetBrains Mono',ui-monospace,monospace;font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-.02em;color:#181d27;text-align:center")}>
      <span style={{ color: "#2563EB" }}>agentic</span>
      <br />
      salesforce
    </div>
  );
}

function ResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [state, setState] = useState<"checking" | "invalid" | "form" | "done">("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    validateResetToken(token).then((res) => {
      if (!live) return;
      if (res.ok) {
        setEmail(res.email || "");
        setState("form");
      } else {
        setState("invalid");
      }
    });
    return () => { live = false; };
  }, [token]);

  const submit = async () => {
    if (loading) return;
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don’t match."); return; }
    setLoading(true);
    const res = await resetPassword({ token, password });
    setLoading(false);
    if (!res.ok) { setError(res.error || "Something went wrong. Please try again."); return; }
    setState("done");
  };

  return (
    <div style={css("min-height:100vh;background:#fff;display:flex;align-items:center;justify-content:center;padding:48px 24px;animation:fadeUp .3s ease")}>
      <div style={css("width:100%;max-width:440px;display:flex;flex-direction:column;gap:28px;align-items:center")}>
        <Wordmark />

        {state === "checking" && (
          <div style={css("font-size:15px;color:#535862")}>Checking your reset link…</div>
        )}

        {state === "invalid" && (
          <div style={css("display:flex;flex-direction:column;gap:20px;width:100%;text-align:center")}>
            <div style={css("font-size:26px;font-weight:700;color:#181d27;letter-spacing:-.01em")}>Link expired or invalid</div>
            <div style={css("font-size:15px;color:#535862;line-height:22px")}>This password reset link is no longer valid. Request a new one from the login screen.</div>
            <Btn onClick={() => { router.push("/"); router.refresh(); }} style="background:#2563EB;color:#fff;border:none;border-radius:100px;padding:12px 16px;width:100%;font-size:16px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.3)" styleHover="background:#1D4ED8">Back to login</Btn>
          </div>
        )}

        {state === "form" && (
          <div style={css("display:flex;flex-direction:column;gap:24px;width:100%")}>
            <div style={css("display:flex;flex-direction:column;gap:10px;text-align:center")}>
              <div style={css("font-size:28px;font-weight:700;color:#181d27;letter-spacing:-.01em")}>Set a new password</div>
              <div style={css("font-size:15px;color:#535862;line-height:22px")}>{email ? "For " + email : "Choose a new password for your account."}</div>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:16px;width:100%")}>
              <div style={css("display:flex;flex-direction:column;gap:6px;width:100%")}>
                <label htmlFor="np" style={css(LABEL)}>New password</label>
                <div style={css(FIELD_WRAP)}>
                  <input id="np" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="At least 8 characters" aria-label="New password" style={css(FIELD_INPUT)} />
                </div>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:6px;width:100%")}>
                <label htmlFor="cp" style={css(LABEL)}>Confirm password</label>
                <div style={css(FIELD_WRAP)}>
                  <input id="cp" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="Re-enter new password" aria-label="Confirm password" style={css(FIELD_INPUT)} />
                </div>
              </div>
              {error && <div role="alert" style={css("font-size:13px;color:#B91C1C;background:#FEECEC;border:1px solid #FBD5D5;border-radius:10px;padding:10px 14px")}>{error}</div>}
            </div>
            <Btn onClick={submit} disabled={loading} style={"background:#2563EB;color:#fff;border:none;border-radius:100px;padding:12px 16px;width:100%;font-size:16px;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,.3);" + (loading ? "opacity:.7;cursor:default" : "cursor:pointer")} styleHover={loading ? "" : "background:#1D4ED8"}>
              {loading ? "Updating…" : "Update password"}
            </Btn>
          </div>
        )}

        {state === "done" && (
          <div style={css("display:flex;flex-direction:column;gap:20px;width:100%;text-align:center")}>
            <div style={css("width:56px;height:56px;border-radius:50%;background:#E7F7EC;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto")}>✓</div>
            <div style={css("font-size:26px;font-weight:700;color:#181d27;letter-spacing:-.01em")}>Password updated</div>
            <div style={css("font-size:15px;color:#535862;line-height:22px")}>Your password has been changed. Log in with your new password.</div>
            <Btn onClick={() => { router.push("/"); router.refresh(); }} style="background:#2563EB;color:#fff;border:none;border-radius:100px;padding:12px 16px;width:100%;font-size:16px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.3)" styleHover="background:#1D4ED8">Go to login</Btn>
          </div>
        )}

        {(state === "form" || state === "invalid") && (
          <Box as="span" onClick={() => { router.push("/"); router.refresh(); }} style="font-size:14px;font-weight:600;color:#2563EB;cursor:pointer">← Back to login</Box>
        )}
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div style={css("min-height:100vh;display:flex;align-items:center;justify-content:center;font-size:15px;color:#535862")}>Loading…</div>}>
      <ResetInner />
    </Suspense>
  );
}
