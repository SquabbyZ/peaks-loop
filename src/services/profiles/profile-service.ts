export type Profile = {
  name: string;
  description: string;
  capabilities: string[];
};

export function listProfiles(): Profile[] {
  return [
    {
      name: 'refactor-guard',
      description: 'Soft gate profile for refactor coverage, slice spec, artifact retention, and commit boundaries.',
      capabilities: ['refactor-coverage-gate', 'refactor-slice-spec', 'artifact-retention']
    },
    {
      name: 'strict-refactor',
      description: 'Strict profile that can enable CLI-managed hooks, agents, and artifact repository checks after approval.',
      capabilities: ['refactor-guard', 'hook-profile', 'artifact-repository', 'doctor']
    },
    {
      name: 'refactor-swarm',
      description: 'Optional swarm orchestration profile for large multi-module refactors.',
      capabilities: ['agent-profile', 'swarm-task-graph', 'handoff-reports']
    }
  ];
}
