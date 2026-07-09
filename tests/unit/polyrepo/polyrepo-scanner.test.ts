import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanPolyrepo } from "../../../src/services/polyrepo/polyrepo-scanner.js";
import { PolyrepoService } from "../../../src/services/polyrepo/polyrepo-service.js";
import { readManifest } from "../../../src/services/polyrepo/polyrepo-dispatcher.js";
import { dispatchArtifact } from "../../../src/services/polyrepo/polyrepo-dispatcher.js";

describe("polyrepo-scanner (RD-2 S2-b)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "peaks-polyrepo-scan-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("auto-discovers children with .git directories", () => {
    mkdirSync(join(root, "frontend"));
    writeFileSync(join(root, "frontend", ".git"), "gitdir: /x\n");
    mkdirSync(join(root, "backend"));
    mkdirSync(join(root, "backend", ".git"));
    mkdirSync(join(root, "docs")); // no .git -> ignored

    const m = scanPolyrepo(root);
    expect(m.root).toBe(root);
    expect(m.version).toBe(1);
    const ids = m.children.map((c) => c.id).sort();
    expect(ids).toEqual(["backend", "frontend"]);
    expect(m.children.find((c) => c.id === "frontend")?.gitRoot).toBe(true);
    expect(m.children.find((c) => c.id === "frontend")?.peaksScope).toBe("child-only");
    expect(m.children.find((c) => c.id === "frontend")?.peaksInstalled).toBe(false);
  });

  it("honors explicit --children override", () => {
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "a", ".git"));
    mkdirSync(join(root, "b"));
    mkdirSync(join(root, "b", ".git"));

    const m = scanPolyrepo(root, { explicitChildren: ["a"] });
    expect(m.children.map((c) => c.id)).toEqual(["a"]);
  });

  it("explicit mode errors when a named child does not exist", () => {
    expect(() => scanPolyrepo(root, { explicitChildren: ["nope"] })).toThrow(/does not exist/);
  });

  it("explicit mode errors when the path is not a directory", () => {
    writeFileSync(join(root, "file.txt"), "x");
    expect(() => scanPolyrepo(root, { explicitChildren: ["file.txt"] })).toThrow(/not a directory/);
  });

  it("errors when the root does not exist", () => {
    expect(() => scanPolyrepo(join(root, "missing"))).toThrow(/does not exist/);
  });

  it("errors when the root is a file, not a directory", () => {
    const file = join(root, "afile");
    writeFileSync(file, "x");
    expect(() => scanPolyrepo(file)).toThrow(/not a directory/);
  });

  it("detects child peaksScope when child already has .peaks/", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    mkdirSync(join(root, "frontend", ".peaks"));

    const m = scanPolyrepo(root);
    const c = m.children.find((x) => x.id === "frontend");
    expect(c?.peaksScope).toBe("root+child");
    expect(c?.peaksInstalled).toBe(true);
  });

  it("skips hidden directories like .git itself", () => {
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "real"));
    mkdirSync(join(root, "real", ".git"));

    const m = scanPolyrepo(root);
    expect(m.children.map((c) => c.id)).toEqual(["real"]);
  });

  it("ignores empty auto-discovery (no children)", () => {
    const m = scanPolyrepo(root);
    expect(m.children).toEqual([]);
  });

  it("sanitizes weird child names into stable ids", () => {
    mkdirSync(join(root, "Front End UI"));
    mkdirSync(join(root, "Front End UI", ".git"));

    const m = scanPolyrepo(root);
    expect(m.children).toHaveLength(1);
    const child = m.children[0];
    expect(child?.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
  });
});

describe("polyrepo-service (RD-2 S2-b)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "peaks-polyrepo-svc-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("init writes the manifest and reports children", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    mkdirSync(join(root, "backend"));
    mkdirSync(join(root, "backend", ".git"));

    const svc = new PolyrepoService();
    const r = svc.init({ root });
    expect(r.created).toBe(true);
    expect(r.manifest.children).toHaveLength(2);
    expect(readManifest(root)).not.toBeNull();
  });

  it("init returns created=false on re-run (overwrite)", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    const svc = new PolyrepoService();
    svc.init({ root });
    const r2 = svc.init({ root });
    expect(r2.created).toBe(false);
  });

  it("status returns manifestExists=false when no manifest", () => {
    const svc = new PolyrepoService();
    const s = svc.status(root);
    expect(s.manifestExists).toBe(false);
    expect(s.children).toEqual([]);
  });

  it("status returns the persisted children", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    const svc = new PolyrepoService();
    svc.init({ root });
    const s = svc.status(root);
    expect(s.manifestExists).toBe(true);
    expect(s.children.map((c) => c.id)).toEqual(["frontend"]);
    expect(s.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("dispatch mirrors an artifact into the target children", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    mkdirSync(join(root, "backend"));
    mkdirSync(join(root, "backend", ".git"));

    const svc = new PolyrepoService();
    svc.init({ root });

    const artifact = join(root, "prd-foo.md");
    writeFileSync(artifact, "# PRD body\n", "utf8");

    const r = svc.dispatch(root, {
      sid: "sid-1",
      rid: "rid-1",
      targets: ["frontend", "backend"],
      role: "prd",
      artifactPath: artifact
    });

    expect(r.perChild).toHaveLength(2);
    expect(r.perChild.every((c) => c.ok)).toBe(true);
    expect(r.dispatch.rid).toBe("rid-1");
    expect(r.dispatch.sid).toBe("sid-1");
    expect(r.dispatch.artifact.role).toBe("prd");

    // Verify the file actually landed in the right shape (Windows + POSIX paths).
    for (const child of r.perChild) {
      expect(child.mirroredTo).toMatch(/[/\\]\.peaks[/\\]_runtime[/\\]sid-1[/\\]prd[/\\]prd-foo\.md$/);
    }
  });

  it("dispatch collects warnings for unknown target ids (does not throw)", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    const svc = new PolyrepoService();
    svc.init({ root });
    const artifact = join(root, "a.md");
    writeFileSync(artifact, "x", "utf8");
    const r = svc.dispatch(root, {
      sid: "sid-1", rid: "rid-1",
      targets: ["frontend", "ghost"],
      role: "rd",
      artifactPath: artifact
    });
    expect(r.perChild).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("dispatch warns when child has no peaks install", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    const svc = new PolyrepoService();
    svc.init({ root });
    const artifact = join(root, "a.md");
    writeFileSync(artifact, "x", "utf8");
    const r = svc.dispatch(root, {
      sid: "sid-1", rid: "rid-1",
      targets: ["frontend"],
      role: "rd",
      artifactPath: artifact
    });
    expect(r.warnings.some((w) => w.includes("peaks-loop install"))).toBe(true);
  });

  it("dispatch throws when no manifest exists", () => {
    const svc = new PolyrepoService();
    expect(() => svc.dispatch(root, {
      sid: "s", rid: "r", targets: [], role: "prd", artifactPath: join(root, "x")
    })).toThrow(/no polyrepo manifest/);
  });

  it("dispatch errors when the source artifact does not exist", () => {
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "frontend", ".git"));
    const svc = new PolyrepoService();
    svc.init({ root });
    expect(() => dispatchArtifact({
      manifest: svc.status(root).children.length > 0
        ? { version: 1, root, detectedAt: new Date().toISOString(), children: [] }
        : { version: 1, root, detectedAt: new Date().toISOString(), children: [] },
      sid: "s", rid: "r", targets: [],
      artifact: { role: "prd", path: join(root, "missing.md") }
    })).toThrow(/unreadable/);
  });
});