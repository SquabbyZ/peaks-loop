export function A11yCleanPage() {
  return (
    <div onClick={() => undefined} role="button" tabIndex={0} className="focus-visible:ring-2">
      Open details
    </div>
  );
}
