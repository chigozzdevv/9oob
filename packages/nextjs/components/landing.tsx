"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Copy, MoveRight, Sparkles } from "lucide-react";
import { NoobWordmark } from "@9oob/sdk/wordmark";
import "~~/components/landing.css";

const scaffoldCommand = "npm create scaffold-hbar@latest -- --template chigozzdevv/9oob";
const examples = [
  { name: "Balance", intent: "Check my HBAR balance", description: "Know what you hold.", color: "green" },
  { name: "Swap", intent: "Swap 0.1 HBAR for USDC", description: "Exchange supported assets.", color: "purple" },
  {
    name: "Bridge",
    intent: "Bridge 0.1 USDC from Hedera to Base",
    description: "Move between networks.",
    color: "yellow",
  },
  { name: "Transfer", intent: "Send 0.01 HBAR to 0.0.123456", description: "Send to another wallet.", color: "coral" },
] as const;

function ActionIllustration({ action }: { action: (typeof examples)[number]["name"] }) {
  if (action === "Balance")
    return (
      <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <rect x="13" y="21" width="54" height="42" rx="12" fill="currentColor" fillOpacity=".15" />
        <path
          d="M20 30h37a8 8 0 0 1 8 8v19a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8V29a10 10 0 0 1 10-10h30"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path d="M65 41H53a6 6 0 0 0 0 12h12" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="54" cy="47" r="2" fill="currentColor" />
        <path d="M31 42v12m9-12v12m-9-9h9m-9 6h9" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      </svg>
    );
  if (action === "Swap")
    return (
      <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <circle cx="40" cy="40" r="28" fill="currentColor" fillOpacity=".12" />
        <path
          d="M18 29h41m-9-10 10 10-10 10M62 51H21m9-10L20 51l10 10"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (action === "Bridge")
    return (
      <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <path
          d="M16 61V33m48 28V33M10 60h60M16 38c12 0 13-17 24-17s12 17 24 17M16 46c12 0 13-17 24-17s12 17 24 17"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M27 43v16m13-27v27m13-16v16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <path
        d="m14 37 51-21-15 49-12-20-24-8Z"
        fill="currentColor"
        fillOpacity=".12"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="m38 45 27-29M18 54l-6 6m18 0-6 6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function CopyScaffold({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "unavailable">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2400);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(scaffoldCommand);
      setStatus("copied");
    } catch {
      setStatus("unavailable");
    }
  }

  return (
    <button
      className={`landing-copy ${className}`}
      type="button"
      onClick={() => void copy()}
      aria-label={status === "copied" ? "Command copied" : "Copy scaffold command"}
      title={status === "unavailable" ? "Select the command to copy it" : "Copy scaffold command"}
    >
      {status === "copied" ? <Check size={15} /> : <Copy size={15} />}
      <span aria-live="polite" className="sr-only">
        {status === "copied" ? "Command copied" : status === "unavailable" ? "Select the command to copy it" : ""}
      </span>
    </button>
  );
}

function IntentIllustration() {
  const [active, setActive] = useState(0);
  const [text, setText] = useState<string>(examples[0].intent);
  const intent = examples[active].intent;

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let typing: ReturnType<typeof setInterval> | undefined;
    let next: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearInterval(typing);
      clearTimeout(next);
    };
    const start = () => {
      stop();
      if (motion.matches) {
        setText(intent);
        return;
      }
      let position = 0;
      setText("");
      typing = setInterval(() => {
        position += 1;
        setText(intent.slice(0, position));
        if (position === intent.length) {
          clearInterval(typing);
          next = setTimeout(() => setActive(value => (value + 1) % examples.length), 3400);
        }
      }, 44);
    };
    const visibility = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    motion.addEventListener("change", start);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      motion.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [intent]);

  return (
    <div
      className="landing-illustration"
      id="get-started"
      aria-label="Create a Hedera app, then call noob.run with an intent"
    >
      <div className="landing-orbit landing-orbit-one" aria-hidden="true" />
      <div className="landing-orbit landing-orbit-two" aria-hidden="true" />
      <svg className="landing-flower" viewBox="0 0 100 100" aria-hidden="true">
        <path
          d="M50 12c12-25 34-9 22 11 23-14 40 10 14 23 28 9 15 37-8 25 13 23-12 39-25 14-9 28-36 16-25-7-24 13-39-12-14-25-28-9-15-36 8-25C9 4 37-10 50 12Z"
          fill="currentColor"
        />
        <circle cx="49" cy="48" r="12" fill="#fbf8f2" />
      </svg>
      <span className="landing-spark landing-spark-one" aria-hidden="true">
        ✦
      </span>
      <span className="landing-spark landing-spark-two" aria-hidden="true">
        ✦
      </span>
      <span className="landing-dot landing-dot-one" aria-hidden="true" />
      <span className="landing-dot landing-dot-two" aria-hidden="true" />
      <div className="landing-stage landing-install">
        <div className="landing-terminal-bar">
          <span className="landing-terminal-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>01 / Create your app</span>
          <CopyScaffold />
        </div>
        <pre className="landing-command">
          <code>
            <span className="landing-code-yellow">npm create</span>
            {" scaffold-hbar@latest\n"}
            <span className="landing-code-muted">-- --template </span>
            <span className="landing-code-lilac">chigozzdevv/9oob</span>
          </code>
        </pre>
      </div>
      <div className="landing-stage-link" aria-hidden="true">
        <span />
        <ArrowDown size={22} strokeWidth={1.7} />
      </div>
      <div className="landing-stage landing-run">
        <div className="landing-run-bar">
          <span>
            <span className="landing-stage-number">02</span> Pass an intent
          </span>
          <Sparkles size={17} strokeWidth={1.6} aria-hidden="true" />
        </div>
        <div className="landing-run-code" aria-hidden="true">
          <span className="landing-code-call">
            noob<span>.run</span>
          </span>
          <span>(</span>
          <span className="landing-code-intent">
            &quot;{text}
            <span className="landing-code-cursor" />
            &quot;
          </span>
          <span>);</span>
        </div>
        <span className="sr-only">
          noob.run accepts a balance, swap, bridge or transfer request in natural language.
        </span>
        <div className="landing-intent-tabs" aria-label="Choose an example intent">
          {examples.map((example, index) => (
            <button key={example.name} type="button" aria-pressed={active === index} onClick={() => setActive(index)}>
              <span className={`landing-tab-dot landing-color-${example.color}`} aria-hidden="true" />
              {example.name}
            </button>
          ))}
        </div>
      </div>
      <div className="landing-illustration-note">
        <ArrowDownLeft size={21} strokeWidth={1.4} aria-hidden="true" />
        <span>your users’ words go here</span>
      </div>
    </div>
  );
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    element.dataset.revealReady = "true";
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14 },
    );
    element.querySelectorAll("[data-reveal]").forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-page" ref={root}>
      <a href="#main" className="landing-skip">
        Skip to content
      </a>
      <header className="landing-header landing-container">
        <Link href="/" className="landing-wordmark" aria-label="9oob home">
          <NoobWordmark />
        </Link>
        <nav aria-label="Main navigation">
          <a className="landing-nav-link" href="#how-it-works">
            How it works
          </a>
          <a className="landing-nav-link" href="#get-started">
            Get started
          </a>
          <Link className="landing-nav-demo" href="/demo">
            Try the demo <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main id="main">
        <section className="landing-hero landing-container" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">
              <span aria-hidden="true" />
              Made for Hedera builders
            </span>
            <h1 id="landing-title">
              Embed natural language onchain actions in your <span>Hedera app.</span>
            </h1>
            <p>
              Balance, swap, bridge and transfer.
              <br />
              One guided conversation.
            </p>
            <div className="landing-hero-actions">
              <Link className="landing-button landing-button-primary" href="/demo">
                Try the demo <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <a
                className="landing-text-link"
                href="https://github.com/chigozzdevv/9oob/blob/main/README.md#setup"
                target="_blank"
                rel="noreferrer"
              >
                Start building <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <span className="landing-network-note">Testnet demo · Hedera + Base Sepolia</span>
          </div>
          <IntentIllustration />
        </section>
        <section className="landing-actions-section landing-container" aria-labelledby="actions-title" data-reveal>
          <div className="landing-section-heading">
            <h2 id="actions-title">
              Four actions.
              <br />
              <span>One conversation.</span>
            </h2>
            <p>
              Your users say it.
              <br />
              9oob guides the rest.
            </p>
          </div>
          <div className="landing-actions-grid">
            {examples.map(example => (
              <article className={`landing-action landing-color-${example.color}`} key={example.name}>
                <div className="landing-action-art">
                  <ActionIllustration action={example.name} />
                </div>
                <h3>{example.name}</h3>
                <p>{example.description}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-flow-section" id="how-it-works" aria-labelledby="flow-title">
          <div className="landing-container landing-flow-inner" data-reveal>
            <div className="landing-flow-copy">
              <span className="landing-eyebrow">From words to action</span>
              <h2 id="flow-title">
                Their words.
                <br />
                <span>Their wallet.</span>
              </h2>
              <p>
                Connect when needed.
                <br />
                Sign when ready.
              </p>
              <Link className="landing-text-link" href="/demo">
                See it in action <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            </div>
            <ol className="landing-flow-steps">
              <li>
                <span className="landing-flow-number">01</span>
                <div>
                  <h3>Describe it.</h3>
                  <p>Say what you want to do.</p>
                </div>
                <span className="landing-flow-symbol" aria-hidden="true">
                  “
                </span>
              </li>
              <li>
                <span className="landing-flow-number">02</span>
                <div>
                  <h3>Review it.</h3>
                  <p>Check the details before signing.</p>
                </div>
                <Check className="landing-flow-check" size={29} strokeWidth={1.8} aria-hidden="true" />
              </li>
              <li>
                <span className="landing-flow-number">03</span>
                <div>
                  <h3>Sign it.</h3>
                  <p>Follow the transaction to confirmation.</p>
                </div>
                <MoveRight size={30} strokeWidth={1.7} aria-hidden="true" />
              </li>
            </ol>
          </div>
        </section>
        <section className="landing-closing landing-container" aria-labelledby="closing-title" data-reveal>
          <span className="landing-closing-spark" aria-hidden="true">
            ✦
          </span>
          <h2 id="closing-title">
            Build for how
            <br />
            people speak.
          </h2>
          <p>Set up your provider once. Pass an intent.</p>
          <a
            className="landing-button landing-button-primary"
            href="https://github.com/chigozzdevv/9oob/blob/main/README.md#setup"
            target="_blank"
            rel="noreferrer"
          >
            Start building <ArrowUpRight size={18} aria-hidden="true" />
          </a>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <Link href="/" className="landing-wordmark" aria-label="9oob home">
          <NoobWordmark />
        </Link>
        <span>Words in. Actions out.</span>
        <Link href="/demo">
          Explore the demo <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
