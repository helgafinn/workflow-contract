import { WorkflowContractError } from './errors.js';
import type {
  PermissionLevel,
  PermissionSpec,
  WorkflowPermissionsContract,
} from './types.js';

/**
 * GitHub's documented permission keys as of the Node 24 action runtime.
 * Explicit keys not in this list are preserved and compared too.
 */
export const KNOWN_PERMISSION_SCOPES = [
  'actions',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'id-token',
  'issues',
  'models',
  'packages',
  'pages',
  'pull-requests',
  'security-events',
  'statuses',
] as const;

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
};

export interface AggregatedPermissionProfile {
  levels: Record<string, PermissionLevel>;
  hasImplicit: boolean;
  /** Permission applied to scopes GitHub may add after this tool is released. */
  wildcardLevel?: 'read' | 'write';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function clonePermissionSpec(spec: PermissionSpec): PermissionSpec {
  return { mode: spec.mode, scopes: { ...spec.scopes } };
}

export function parsePermissionSpec(
  value: unknown,
  source: string,
  path: string,
): PermissionSpec {
  if (value === undefined) {
    return { mode: 'implicit', scopes: {} };
  }

  if (value === 'read-all' || value === 'write-all') {
    return { mode: value, scopes: {} };
  }

  // `permissions: {}` intentionally removes all permissions. Treat a null value
  // the same way so the comparison remains conservative for incomplete YAML.
  if (value === null) {
    return { mode: 'explicit', scopes: {} };
  }

  if (!isRecord(value)) {
    throw new WorkflowContractError(
      'permissions.invalid',
      `${source}: ${path} must be read-all, write-all, or a permission map.`,
      { source },
    );
  }

  const scopes: Record<string, PermissionLevel> = {};
  for (const [scope, level] of Object.entries(value)) {
    if (level !== 'none' && level !== 'read' && level !== 'write') {
      throw new WorkflowContractError(
        'permissions.invalid-level',
        `${source}: ${path}.${scope} must be none, read, or write.`,
        { source },
      );
    }
    scopes[scope] = level;
  }

  return { mode: 'explicit', scopes: sortRecord(scopes) };
}

export function permissionRank(level: PermissionLevel): number {
  return LEVEL_RANK[level];
}

export function permissionLevelAt(
  spec: PermissionSpec,
  scope: string,
): PermissionLevel | undefined {
  switch (spec.mode) {
    case 'implicit':
      return undefined;
    case 'read-all':
      return 'read';
    case 'write-all':
      return 'write';
    case 'explicit':
      return spec.scopes[scope] ?? 'none';
  }
}

export function permissionScopes(...specs: PermissionSpec[]): string[] {
  const scopes = new Set<string>();
  for (const spec of specs) {
    for (const scope of Object.keys(spec.scopes)) {
      scopes.add(scope);
    }
    if (spec.mode === 'read-all' || spec.mode === 'write-all') {
      for (const scope of KNOWN_PERMISSION_SCOPES) {
        scopes.add(scope);
      }
    }
  }
  return [...scopes].sort((left, right) => left.localeCompare(right));
}

/**
 * Aggregate effective requests across jobs. The parser records every job with
 * its effective spec after workflow-level inheritance, so a job override
 * replaces—rather than combines with—the workflow default.
 */
export function aggregatePermissionProfile(
  permissions: WorkflowPermissionsContract,
): AggregatedPermissionProfile {
  const levels: Record<string, PermissionLevel> = {};
  const jobSpecs = Object.values(permissions.jobs);
  const specs = jobSpecs.length > 0 ? jobSpecs : [permissions.workflow];
  let hasImplicit = false;
  let wildcardLevel: 'read' | 'write' | undefined;

  for (const spec of specs) {
    if (spec.mode === 'implicit') {
      hasImplicit = true;
      continue;
    }

    if (spec.mode === 'read-all' || spec.mode === 'write-all') {
      const candidate = spec.mode === 'read-all' ? 'read' : 'write';
      if (
        wildcardLevel === undefined ||
        permissionRank(candidate) > permissionRank(wildcardLevel)
      ) {
        wildcardLevel = candidate;
      }
    }

    for (const scope of permissionScopes(spec)) {
      const level = permissionLevelAt(spec, scope);
      if (level === undefined || level === 'none') {
        continue;
      }
      const previous = levels[scope] ?? 'none';
      if (permissionRank(level) > permissionRank(previous)) {
        levels[scope] = level;
      }
    }
  }

  const profile: AggregatedPermissionProfile = {
    levels: sortRecord(levels),
    hasImplicit,
  };
  if (wildcardLevel !== undefined) {
    profile.wildcardLevel = wildcardLevel;
  }
  return profile;
}

/** Return every permission that at least one callee job explicitly requests. */
export function aggregateKnownPermissionRequests(
  permissions: WorkflowPermissionsContract,
): Record<string, PermissionLevel> {
  return aggregatePermissionProfile(permissions).levels;
}
