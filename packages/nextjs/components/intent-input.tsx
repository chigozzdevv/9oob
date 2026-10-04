"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { noob } from "@9oob/sdk";
import { plainTextIntent } from "@9oob/schema";
import { ArrowUp, LoaderCircle } from "lucide-react";

export function IntentInput({ examples = [] }: { examples?: Array<{ label: string; intent: string }> }) {
  const [intent, setIntent] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 3500);
    return () => clearTimeout(timer);
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intent.trim() || pending) return;
    setPending(true);
    setError("");
    const value = plainTextIntent(intent);
    setIntent(value);
    try {
      await noob.run(value);
      setIntent("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start this intent");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="home-shell">
      {examples.length ? (
        <div className="demo-examples" aria-label="Try an intent">
          {examples.map(example => (
            <button
              key={example.label}
              type="button"
              disabled={pending}
              aria-pressed={intent === example.intent}
              onClick={() => {
                setIntent(example.intent);
                input.current?.focus();
              }}
            >
              {example.label}
            </button>
          ))}
        </div>
      ) : null}
      <form className="home-composer" onSubmit={event => void submit(event)}>
        <label className="sr-only" htmlFor="intent">
          Describe what you want to do
        </label>
        <textarea
          id="intent"
          ref={input}
          value={intent}
          onChange={event => setIntent(event.target.value)}
          placeholder="Describe what you want to do…"
          maxLength={2000}
          rows={2}
        />
        <div className="home-composer-footer">
          <span>{intent.length ? `${intent.length}/2,000` : ""}</span>
          <button className="home-submit" type="submit" disabled={!intent.trim() || pending} aria-label="Run intent">
            {pending ? <LoaderCircle className="noob-spin" size={18} /> : <ArrowUp size={19} />}
          </button>
        </div>
      </form>
      {error ? (
        <p className="home-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
