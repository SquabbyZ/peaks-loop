export function A11yBadPage() {
  return (
    <div onClick={() => undefined}>
      <span role="button">Open</span>
      <li onClick={() => undefined}>Item</li>
    </div>
  );
}
