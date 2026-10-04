export function NoobWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`noob-wordmark ${className}`}>
      <span className="noob-wordmark-nine" aria-hidden="true">
        <span>9</span>
      </span>
      <span aria-hidden="true">oob</span>
      <span className="noob-sr-only">9oob</span>
    </span>
  );
}
