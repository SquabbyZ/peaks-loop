// The `peaks sub-agent dispatch` record write: the optional G7 artifact meta, the graph
// node binding, the dispatch record itself, and the batch counter.
import { existsSync } from 'node:fs';
import { getErrorMessage } from 'peaks-loop-shared/result';
import { noteDispatched } from '../../services/dispatch/batch-counter.js';
import { writeInitialDispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';
import { provisionDispatchNode } from '../../services/workflow/provision-dispatch-node.js';
import { buildArtifactMeta, type ArtifactMeta } from '../../services/context/artifact-meta.js';
import { assertSafeArtifactPath } from 'peaks-loop-shared-channel';
import { type SubAgentToolCall } from '../../services/dispatch/sub-agent-dispatcher.js';
import { type DispatchOptions } from './sub-agent-shared.js';

export interface WriteDispatchRecordInput {
  options: DispatchOptions;
  projectRoot: string;
  sid: string;
  rid: string;
  role: string;
  effectivePrompt: string;
  toolCall: SubAgentToolCall;
  batchId: string;
  isolationMode: 'worktree' | 'container' | 'vm' | null;
  leaseId: string | null;
  /** The dispatch's warning list — this function appends to it, as the inline block did. */
  warnings: string[];
}

export interface DispatchRecordWrite {
  artifactMeta: ArtifactMeta | null;
  dispatchRecordPath: string;
  counter: ReturnType<typeof noteDispatched>;
}

// G7 — optional --write-artifact: build ArtifactMeta, attach to record.
function resolveArtifactMeta(input: WriteDispatchRecordInput): ArtifactMeta | null {
  const { options, projectRoot, rid, role, warnings } = input;
  let artifactMeta: ArtifactMeta | null = null;
  if (typeof options.writeArtifact === 'string' && options.writeArtifact.length > 0) {
    try {
      assertSafeArtifactPath(options.writeArtifact, projectRoot);
      if (!existsSync(options.writeArtifact)) {
        warnings.push('ARTIFACT_NOT_FOUND');
      } else {
        artifactMeta = buildArtifactMeta({
          path: options.writeArtifact,
          rid,
          role,
          idx: 1, // single dispatch, idx=1
          summary: null
        });
      }
    } catch (err) {
      warnings.push(`ARTIFACT_PATH_INVALID: ${getErrorMessage(err)}`);
    }
  }
  return artifactMeta;
}

// Slice 4.0.8 RD §4 D4c: bind this dispatch to a graph node. When the
// caller names none, provision one — that is what collapses the
// documented three-step ritual (create graph -> `peaks workflow node
// prepare` -> dispatch) into a single call. Those three fields were
// also never passed to the writer, so the record's graph binding was
// always null and the writer's transition never fired: the feature was
// inert, and only its precondition (the required flag) was real.
function resolveGraphBinding(
  options: DispatchOptions,
  projectRoot: string,
  sid: string,
  role: string
): { nodeId: string; workflowId: string | null; graphRef: string | null } {
  if (typeof options.graphNode === 'string' && options.graphNode.length > 0) {
    return {
      nodeId: options.graphNode,
      workflowId: options.workflowId ?? null,
      graphRef: options.graphRef ?? null
    };
  }
  const provisioned = provisionDispatchNode({
    projectRoot,
    sessionId: sid,
    role,
    workflowId: options.workflowId,
    graphRef: options.graphRef
  });
  return {
    nodeId: provisioned.nodeId,
    workflowId: provisioned.workflowId,
    graphRef: provisioned.graphRef
  };
}

export function writeDispatchRecord(input: WriteDispatchRecordInput): DispatchRecordWrite {
  const {
    options,
    projectRoot,
    sid,
    rid,
    role,
    effectivePrompt,
    toolCall,
    batchId,
    isolationMode,
    leaseId,
    warnings
  } = input;

  const artifactMeta = resolveArtifactMeta(input);

  const graphBinding = resolveGraphBinding(options, projectRoot, sid, role);

  const { path: dispatchRecordPath } = writeInitialDispatchRecord({
    projectRoot,
    sessionId: sid,
    requestId: rid,
    role,
    prompt: effectivePrompt,
    workflowId: graphBinding.workflowId,
    graphNodeId: graphBinding.nodeId,
    graphRef: graphBinding.graphRef,
    toolCall,
    batchId,
    // lease id on the dispatch record so the finalize-time
    // release hook (markCompleted / heartbeat --status done) can
    // auto-fire `peaks worktree release` when the sub-agent
    // completes. Null when --isolation was not requested.
    leaseId,
    // ISO timestamp when the isolation mode was set up. Null
    // when --isolation was not requested. The dashboard reads
    // this directly off the dispatch record to compute
    // isolation duration without cross-referencing the
    // metrics stream.
    isolationStartedAt: isolationMode !== null ? new Date().toISOString() : null
  });
  const counter = noteDispatched(projectRoot, sid, batchId);
  if (counter.warning) {
    warnings.push(counter.warning.message);
  }

  return { artifactMeta, dispatchRecordPath, counter };
}
