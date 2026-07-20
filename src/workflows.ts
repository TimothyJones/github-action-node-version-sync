import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  Scalar,
  type Document,
  type Node,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import {
  parseVersionLiteral,
  renderVersion,
  representativeStyle,
  type ParsedVersion,
} from "./format.js";
import type {
  CheckImpact,
  Editor,
  FilePlan,
  VersionChange,
} from "./reconcile.js";
import type { Schedule } from "./schedule.js";

const SETUP_NODE = /^actions\/setup-node(@.*)?$/;
const MATRIX_REF = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/;

/** A step scope: workflow jobs carry a matrix + steps; composite actions carry steps only. */
interface Scope {
  jobId?: string;
  jobName?: string;
  matrix?: YAMLMap;
  steps?: YAMLSeq;
}

/** A node-version matrix array plus the info needed to name its CI status checks. */
interface MatrixInfo {
  seq: YAMLSeq;
  /** The job id (key under `jobs:`); "" when unknown. */
  jobId: string;
  /**
   * True when the check context is confidently `<jobId> (<value>)` — i.e. the job has
   * a default name and `node` is the matrix's only dimension. False for custom job
   * names or multi-dimension matrices, where the exact check name can't be derived.
   */
  simple: boolean;
}

/** The Node-version-bearing locations found in one document. */
interface Analysis {
  /** Matrix arrays referenced by a setup-node `${{ matrix.KEY }}` node-version (multi-version). */
  matrices: MatrixInfo[];
  /** Scalar setup-node node-version pins holding a concrete numeric version (single-version). */
  scalarPins: Scalar[];
}

function getNode(map: unknown, key: string): Node | undefined {
  if (!isMap(map)) return undefined;
  return (map.get(key, true) as Node | undefined) ?? undefined;
}

function collectScopes(doc: Document): Scope[] {
  const scopes: Scope[] = [];
  const root = doc.contents;
  if (!isMap(root)) return scopes;

  const jobs = getNode(root, "jobs");
  if (isMap(jobs)) {
    for (const pair of jobs.items) {
      const job = pair.value;
      if (!isMap(job)) continue;
      const jobId = isScalar(pair.key)
        ? String((pair.key as Scalar).value)
        : String(pair.key);
      const nameNode = job.get("name");
      const jobName = typeof nameNode === "string" ? nameNode : undefined;
      const strategy = getNode(job, "strategy");
      const matrix = isMap(strategy) ? getNode(strategy, "matrix") : undefined;
      const steps = getNode(job, "steps");
      scopes.push({
        jobId,
        jobName,
        matrix: isMap(matrix) ? matrix : undefined,
        steps: isSeq(steps) ? steps : undefined,
      });
    }
  }

  // Composite action: runs.steps (no matrix concept).
  const runs = getNode(root, "runs");
  if (isMap(runs)) {
    const steps = getNode(runs, "steps");
    if (isSeq(steps)) scopes.push({ steps });
  }

  return scopes;
}

/** Read the parsed version out of a sequence/scalar item. */
function itemVersion(item: unknown): ParsedVersion | undefined {
  return parseVersionLiteral(isScalar(item) ? (item as Scalar).value : item);
}

/** True when the matrix has dimensions beyond `nodeKey`, or uses include/exclude. */
function isMultiDimension(matrix: YAMLMap, nodeKey: string): boolean {
  let listKeys = 0;
  for (const pair of matrix.items) {
    const key = isScalar(pair.key)
      ? String((pair.key as Scalar).value)
      : String(pair.key);
    if (key === "include" || key === "exclude") return true;
    if (isSeq(pair.value)) listKeys += 1;
  }
  return listKeys > 1 && matrix.has(nodeKey);
}

function analyze(doc: Document): Analysis {
  const matrices: MatrixInfo[] = [];
  const scalarPins: Scalar[] = [];

  for (const scope of collectScopes(doc)) {
    if (!scope.steps) continue;
    for (const step of scope.steps.items) {
      if (!isMap(step)) continue;
      const uses = step.get("uses");
      if (typeof uses !== "string" || !SETUP_NODE.test(uses.trim())) continue;

      const withMap = getNode(step, "with");
      if (!isMap(withMap)) continue;
      const nv = withMap.get("node-version", true);
      if (!isScalar(nv)) continue;

      const value = nv.value;
      if (typeof value === "string") {
        const ref = MATRIX_REF.exec(value.trim());
        if (ref) {
          const seq = scope.matrix
            ? (scope.matrix.get(ref[1], true) as Node | undefined)
            : undefined;
          if (isSeq(seq) && !matrices.some((m) => m.seq === seq)) {
            const multiDimension = scope.matrix
              ? isMultiDimension(scope.matrix, ref[1])
              : false;
            matrices.push({
              seq,
              jobId: scope.jobId ?? "",
              simple: Boolean(scope.jobId) && !scope.jobName && !multiDimension,
            });
          }
          continue;
        }
      }

      if (
        parseVersionLiteral(value) !== undefined &&
        !scalarPins.includes(nv)
      ) {
        scalarPins.push(nv);
      }
    }
  }

  return { matrices, scalarPins };
}

function insertMajor(seq: YAMLSeq, major: number): void {
  const numeric: ParsedVersion[] = [];
  for (const item of seq.items) {
    const p = itemVersion(item);
    if (p) {
      if (p.major === major) return; // already present
      numeric.push(p);
    }
  }

  const style = representativeStyle(numeric);
  const value = renderVersion(major, style);
  const node = new Scalar(value);

  if (typeof value === "string") {
    // Copy the quote style of an existing string entry so the new one matches.
    const rep = seq.items.find(
      (it) => isScalar(it) && typeof (it as Scalar).value === "string",
    );
    if (isScalar(rep)) node.type = (rep as Scalar).type;
  }

  // Insert before the first numeric entry with a higher major, keeping ascending order.
  let idx = seq.items.length;
  for (let i = 0; i < seq.items.length; i++) {
    const p = itemVersion(seq.items[i]);
    if (p && p.major > major) {
      idx = i;
      break;
    }
  }
  seq.items.splice(idx, 0, node);
}

function removeMajor(seq: YAMLSeq, major: number): void {
  for (let i = seq.items.length - 1; i >= 0; i--) {
    const p = itemVersion(seq.items[i]);
    if (p && p.major === major) seq.items.splice(i, 1);
  }
}

function applyWorkflow(
  content: string,
  change: VersionChange,
  schedule: Schedule,
): string {
  const doc = parseDocument(content);
  const { matrices, scalarPins } = analyze(doc);

  if (change.kind === "add") {
    for (const m of matrices) insertMajor(m.seq, change.major);
  } else {
    for (const m of matrices) removeMajor(m.seq, change.major);
    if (schedule.newestEven !== undefined) {
      for (const pin of scalarPins) {
        const p = parseVersionLiteral(pin.value);
        if (p && p.major === change.major) {
          const value = renderVersion(schedule.newestEven, p.style);
          pin.value = value;
          if (typeof value === "number") pin.type = Scalar.PLAIN;
        }
      }
    }
  }

  // `flowCollectionPadding: false` keeps `[20, 22, 24]` compact (no inner padding),
  // minimising cosmetic diff noise in the resulting PR.
  return doc.toString({ flowCollectionPadding: false });
}

export const workflowEditor: Editor = {
  plan(path: string, content: string, schedule: Schedule): FilePlan | null {
    let doc: Document;
    try {
      doc = parseDocument(content);
    } catch {
      return null;
    }
    if (doc.errors.length > 0 || !isMap(doc.contents)) return null;

    const { matrices, scalarPins } = analyze(doc);
    if (matrices.length === 0 && scalarPins.length === 0) return null;

    const changes = new Map<string, VersionChange>();
    const record = (kind: VersionChange["kind"], major: number) =>
      changes.set(`${kind}:${major}`, { kind, major });
    const checkImpacts: CheckImpact[] = [];

    for (const matrix of matrices) {
      // Map each present major to its rendered string (as the CI check context spells it).
      const present = new Map<number, string>();
      const parsed: ParsedVersion[] = [];
      for (const item of matrix.seq.items) {
        const p = itemVersion(item);
        if (!p) continue;
        present.set(
          p.major,
          String(isScalar(item) ? (item as Scalar).value : item),
        );
        parsed.push(p);
      }
      const style = representativeStyle(parsed);

      const added: string[] = [];
      for (const even of schedule.activeEven) {
        if (!present.has(even)) {
          record("add", even);
          added.push(String(renderVersion(even, style)));
        }
      }
      const removed: string[] = [];
      for (const [m, rendered] of present) {
        if (!schedule.isActive(m)) {
          record("drop", m);
          removed.push(rendered);
        }
      }

      if (added.length || removed.length) {
        checkImpacts.push({
          jobId: matrix.jobId,
          simple: matrix.simple,
          added,
          removed,
        });
      }
    }

    for (const pin of scalarPins) {
      const p = parseVersionLiteral(pin.value);
      if (p && !schedule.isActive(p.major)) {
        // Bumping the pin drops its EOL major and introduces the newest even active one.
        record("drop", p.major);
        if (schedule.newestEven !== undefined)
          record("add", schedule.newestEven);
      }
    }

    if (changes.size === 0) return null;

    return {
      path,
      changes: [...changes.values()],
      checkImpacts: checkImpacts.length ? checkImpacts : undefined,
      apply: (c, change) => applyWorkflow(c, change, schedule),
    };
  },
};
