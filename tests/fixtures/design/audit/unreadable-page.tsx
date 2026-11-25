export function UnreadablePage() {
  return (
    <section style={{ gap: 'calc(100% - 2rem)' }}>
      <div style={{ padding: 'var(--spacing)' }}>A</div>
      <div className="p-[var(--spacing)]">B</div>
    </section>
  );
}
