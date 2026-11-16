"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Download, MessageSquare, RefreshCw, Sparkles } from "lucide-react";
import { applicable, bank, type Interview } from "@/lib/interview/engine";
import { conflictEvidence } from "@/lib/interview/conflict-display";
type Data = { state: Interview; version: number; mode: string; handoff: unknown };
export function InterviewApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [ownWords, setOwnWords] = useState(false);
  const [showJson, setShowJson] = useState(false);
  async function load() {
    try {
      const r = await fetch("/api/interview", { cache: "no-store" });
      const parsed = await r.json();
      if (!r.ok) throw new Error(parsed.error ?? "Unable to load your interview.");
      setData(parsed); setError("");
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/interview", { cache: "no-store", signal: controller.signal })
      .then(async r => {
        const parsed = await r.json();
        if (!r.ok) throw new Error(parsed.error ?? "Unable to load your interview.");
        setData(parsed);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  async function send(action: string, extra: Record<string, unknown> = {}) {
    if (!data || busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: data.version, question_id: data.state.next_question?.id, ...extra }) });
      const parsed = await r.json();
      if (!r.ok) throw new Error(parsed.error ?? "Your answer could not be saved.");
      setData(parsed); setSelected([]); setText(""); setOwnWords(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const state = data?.state;
  const question = state?.next_question;
  const hasConflict = Boolean(state?.unresolved_conflicts.length);
  const needsClarification = Boolean(question && (hasConflict || question.id.startsWith("followup:") || state?.helped.includes(question.field)));
  const evidence = state ? conflictEvidence(state) : [];
  const conflictPrompts: Record<string, string> = {
    capacity: "Which preference should we revise?",
    horizon: "Which matters more: your withdrawal date or long-term growth?",
    crypto: "Should we exclude crypto or revisit your main goal?",
    return: "Would you like to keep your risk limits and revisit the return target?",
    liquidity_amount: "What reserve amount should we use?",
    liquidity_zero: "Do you need a near-term reserve?",
  };
  const questionText = question?.id.startsWith("conflict:")
    ? conflictPrompts[question.id.slice(9)] ?? question.text
    : question?.text;
  const latestAnswer = state?.last_answer ?? (hasConflict && state?.history.length ? { text: state.history.at(-1)!.answer, extracted_fields: [], needs_clarification: true } : null);
  const progress = state ? bank.filter(e => applicable(e, state.profile) && (state.profile[e.field] !== null || (e.optional && state.answered.includes(e.field)))).length : 0;
  const topicCount = state ? bank.filter(e => applicable(e, state.profile)).length : bank.length;
  function select(option: string) {
    if (!question || busy) return;
    if (option === "Answer in my own words") { setOwnWords(true); setSelected([]); return; }
    setOwnWords(false);
    if (question.selection === "single" || option === "Not sure" || option.startsWith("No ")) setSelected([option]);
    else setSelected(prev => prev.includes(option) ? prev.filter(s => s !== option) : [...prev.filter(s => s !== "Not sure" && !s.startsWith("No ")), option]);
  }
  return <div className="interview-shell">
    <header className="interview-nav"><Link href="/" className="interview-brand"><Sparkles size={21} /> AlphaForge</Link><Link href="/">Open optimizer <ArrowRight size={15} /></Link></header>
    <main className="interview-main">
      <div className="interview-heading"><span className="eyebrow">YOUR INVESTOR PROFILE</span><h1>A portfolio starts with you.</h1><p>A few thoughtful questions about your goals, comfort with risk, and what matters to you. Take your time. “Not sure” is welcome.</p></div>
      <div className="interview-layout">
        <section className="interview-card" aria-busy={busy}>
          <div className="interview-card-top"><span><MessageSquare size={16} /> {state?.status === "complete" ? "Profile confirmed" : state?.ready_for_review ? "Review your profile" : needsClarification ? "Your interview" : "Let's talk about your goals"}</span><span className="muted small">{progress} / {topicCount} topics</span></div>
          <progress className="interview-progress" value={progress} max={topicCount} aria-label="Profile topics covered" />
          {error && <div role="alert" className="interview-error">{error} <button onClick={() => void load()}>Reload interview</button> <a href="/api/auth/login">Sign in</a></div>}
          {!state && !error && <p className="interview-loading">Loading your interview…</p>}
          {state && <>
            {!needsClarification && <p className="interview-message" role="status">{state.message}</p>}
            {latestAnswer && !hasConflict && <div className={`interview-last-answer${needsClarification ? " interview-last-answer--compact" : ""}`}>
              <span className="eyebrow">YOUR ANSWER</span>
              <p>{latestAnswer.text}</p>
              {!needsClarification && latestAnswer.extracted_fields.length > 0 && <p className="small">Updated: {latestAnswer.extracted_fields.map(field => `${field.replaceAll("_", " ")}: ${Array.isArray(state.profile[field]) ? (state.profile[field] as string[]).join(", ") || "none" : field === "crypto_max" ? `${Number(state.profile[field]) * 100}%` : state.profile[field] === null ? "unspecified" : String(state.profile[field]).replaceAll("_", " ")}`).join(" · ")}</p>}
            </div>}
            {question ? <form className={`interview-question${hasConflict ? " interview-question--conflict" : needsClarification ? " interview-question--clarification" : ""}`} aria-describedby={needsClarification ? (hasConflict ? "interview-ai-clarification interview-conflict-context" : "interview-ai-clarification") : undefined} key={question.id} onSubmit={e => { e.preventDefault(); void send("answer", ownWords ? { text } : { values: selected }); }}>
              {needsClarification ? <div className="interview-ai-clarification" id="interview-ai-clarification" role="note">
                <span className="interview-ai-badge"><Sparkles size={14} aria-hidden="true" /> AI clarification</span>
                {hasConflict && <span className="interview-conflict-label">Preferences conflict</span>}
              </div> : <span className="eyebrow">{question.selection === "multiple" ? "SELECT ALL THAT APPLY" : "CHOOSE ONE OR USE YOUR OWN WORDS"}</span>}
              {hasConflict && <dl className="interview-conflict-evidence" id="interview-conflict-context" aria-label="Preferences to reconcile">{evidence.map((item, i) => <div key={i}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
              <h2>{questionText}</h2>
              {needsClarification ? <>
                <p className="interview-selection-hint">{question.selection === "multiple" ? "Select all that apply, or use your own words." : "Choose one, or use your own words."}</p>
                <details className="interview-explanation"><summary>Why we’re asking</summary>
                  {hasConflict && <p>{state.unresolved_conflicts[0]?.text}</p>}
                  <p>{question.help}</p>
                </details>
              </> : <p className="interview-help">{question.help}</p>}
              <div className="interview-options">{question.options.map(option => <button type="button" disabled={busy} key={option} aria-pressed={option === "Answer in my own words" ? ownWords : selected.includes(option)} onClick={() => select(option)} className={(selected.includes(option) || (option === "Answer in my own words" && ownWords)) ? "chosen" : ""}><span>{option}</span>{selected.includes(option) && <Check size={17} />}</button>)}</div>
              {ownWords && <label className="interview-free">Your answer<textarea disabled={busy} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (text.trim() && !busy) e.currentTarget.form?.requestSubmit(); } }} autoFocus rows={3} maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder={question.field === "crypto_max" ? "For example: 3%" : "Tell us what feels closest to your situation…"} /><span className="small muted">Enter to send · Shift+Enter for a new line</span></label>}
              <button type="submit" className="button button-primary interview-next" disabled={busy || (ownWords ? !text.trim() : !selected.length)}>{busy ? "Saving your answer…" : "Continue"}<ArrowRight size={17} /></button>
            </form> : <div className="interview-review"><h2>{state.status === "complete" ? "Your profile is ready." : state.ready_for_review ? "Does this sound like you?" : "A few details still need clarification."}</h2><p>{state.ready_for_review ? "Review the details alongside this conversation. You can revisit any answer before confirming." : "Use Revisit next to an unknown required field to continue. You can leave optional details unknown."}</p>{state.ready_for_review && state.status !== "complete" && <button disabled={busy} className="button button-primary" onClick={() => void send("confirm")}>Confirm my profile <Check size={17} /></button>}<a className="button" href="/api/interview?download=1"><Download size={16} /> Download profile JSON</a><p className="small muted">This step creates your profile. Portfolio construction requires translating your preferences into supported AlphaForge limits and verifying exclusions.</p></div>}
            {state.history.length > 0 && <details className="interview-history"><summary>Conversation so far · {state.history.length} answers</summary>{state.history.map((item, i) => <div key={i}><p>{item.question}</p><strong>{item.answer}</strong></div>)}</details>}
          </>}
        </section>
        <aside className="interview-sidebar"><div className="interview-summary"><span className="eyebrow">TAKING SHAPE</span><h2>Your profile</h2><p className="small muted">Answers save as you go. You can return to this page to continue.</p>{state && <dl>{bank.filter(entry => applicable(entry, state.profile)).map(entry => <div key={entry.field}><dt>{entry.field.replaceAll("_", " ")}</dt><dd>{state.profile[entry.field] === null ? "Not known yet" : Array.isArray(state.profile[entry.field]) ? ((state.profile[entry.field] as string[]).join(", ") || "None") : entry.field === "crypto_max" ? `${Number(state.profile.crypto_max) * 100}% maximum` : String(state.profile[entry.field]).replaceAll("_", " ")}<button disabled={busy} onClick={() => void send("edit", { field: entry.field })}>Revisit</button></dd></div>)}</dl>}</div>
          <button className="button" onClick={() => setShowJson(!showJson)}>{showJson ? "Hide" : "Preview"} JSON</button>{showJson && state && <pre className="interview-json">{JSON.stringify({ ...state, handoff: data?.handoff }, null, 2)}</pre>}
          <details className="interview-restart"><summary>Start over</summary><p className="small muted">This replaces your saved interview. Download your JSON first if you want to keep it.</p><button className="button" disabled={busy} onClick={() => void send("restart")}><RefreshCw size={14} /> Replace interview</button></details>
        </aside>
      </div>
    </main>
  </div>;
}
