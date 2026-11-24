import type { ProjectForwardDirection, Vec3 } from '../model';
export const PROJECT_SIGNED_VIEWS = Object.freeze([
  'front',
  'rear',
  'left',
  'right',
  'up',
  'down',
] as const);
export type ProjectSignedView = (typeof PROJECT_SIGNED_VIEWS)[number];
export type ProjectAxisVector = Vec3;

export interface ProjectViewFrame {
  /** Screen-right axis; always exactly cross × depth. */
  readonly inline: ProjectAxisVector;
  readonly cross: ProjectAxisVector;
  /** Camera position is on this positive axis and looks toward its negative. */
  readonly depth: ProjectAxisVector;
}

interface FrameBasis {
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly left: Vec3;
  readonly right: Vec3;
}

const FRAME_BY_FORWARD: Readonly<Record<ProjectForwardDirection, FrameBasis>> = {
  north: {
    forward: [0, 0, -1],
    up: [0, 1, 0],
    left: [-1, 0, 0],
    right: [1, 0, 0],
  },
  south: {
    forward: [0, 0, 1],
    up: [0, 1, 0],
    left: [1, 0, 0],
    right: [-1, 0, 0],
  },
  east: {
    forward: [1, 0, 0],
    up: [0, 1, 0],
    left: [0, 0, -1],
    right: [0, 0, 1],
  },
  west: {
    forward: [-1, 0, 0],
    up: [0, 1, 0],
    left: [0, 0, 1],
    right: [0, 0, -1],
  },
};

const frozenVector = (value: Vec3): ProjectAxisVector => Object.freeze(value);

const negateVector = (value: ProjectAxisVector): ProjectAxisVector =>
  frozenVector([-value[0], -value[1], -value[2]]);

export const projectWorldBasis = (
  forward: ProjectForwardDirection,
): Readonly<Record<'longitudinal' | 'transverse' | 'vertical', ProjectAxisVector>> => {
  const basis = FRAME_BY_FORWARD[forward];
  return Object.freeze({
    longitudinal: frozenVector(basis.forward),
    transverse: frozenVector(basis.right),
    vertical: frozenVector(basis.up),
  });
};

/** Closed signed orthographic frame shared by proof, renderer, and capture. */
export const projectSignedViewFrame = (
  forward: ProjectForwardDirection,
  view: ProjectSignedView,
): Readonly<ProjectViewFrame> => {
  const basis = projectWorldBasis(forward);
  if (view === 'front')
    return Object.freeze({
      inline: negateVector(basis.transverse),
      cross: basis.vertical,
      depth: basis.longitudinal,
    });
  if (view === 'rear')
    return Object.freeze({
      inline: basis.transverse,
      cross: basis.vertical,
      depth: negateVector(basis.longitudinal),
    });
  if (view === 'left')
    return Object.freeze({
      inline: negateVector(basis.longitudinal),
      cross: basis.vertical,
      depth: negateVector(basis.transverse),
    });
  if (view === 'right')
    return Object.freeze({
      inline: basis.longitudinal,
      cross: basis.vertical,
      depth: basis.transverse,
    });
  if (view === 'up')
    return Object.freeze({
      inline: negateVector(basis.longitudinal),
      cross: basis.transverse,
      depth: basis.vertical,
    });
  return Object.freeze({
    inline: negateVector(basis.longitudinal),
    cross: negateVector(basis.transverse),
    depth: negateVector(basis.vertical),
  });
};
