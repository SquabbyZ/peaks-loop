export type OpenSpecProposal = {
  why: string;
  whatChanges: string[];
  outOfScope: string[];
  dependencies: string[];
  risks: string[];
  acceptanceCriteria: string[];
};

export type OpenSpecTaskSection = {
  heading: string;
  total: number;
  done: number;
};

export type OpenSpecTaskProgress = {
  totalTodo: number;
  doneTodo: number;
  sections: OpenSpecTaskSection[];
};

export type OpenSpecChangePaths = {
  root: string;
  proposal: string | null;
  tasks: string | null;
  design: string | null;
};

export type OpenSpecChangeSummary = {
  id: string;
  paths: OpenSpecChangePaths;
  specs: string[];
  taskProgress: OpenSpecTaskProgress | null;
};

export type OpenSpecChangeDetail = OpenSpecChangeSummary & {
  proposal: OpenSpecProposal | null;
};

export type OpenSpecScanReport = {
  openspecRoot: string;
  changesRoot: string;
  exists: boolean;
  changes: OpenSpecChangeSummary[];
};
