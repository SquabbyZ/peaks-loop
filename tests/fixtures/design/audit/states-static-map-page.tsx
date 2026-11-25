const TIME_RANGE_PRESETS = ['Day', 'Week', 'Month'];

export function StatesStaticMapPage() {
  return (
    <section>
      <h1>Presets</h1>
      {TIME_RANGE_PRESETS.map((preset) => (
        <button key={preset} className="bg-primary px-2 py-1 rounded">
          {preset}
        </button>
      ))}
    </section>
  );
}
