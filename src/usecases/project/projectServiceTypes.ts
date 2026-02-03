import type { Capabilities, ToolError } from '../../types';
import type { EditorPort } from '../../ports/editor';
import type { FormatPort } from '../../ports/formats';
import type { ProjectSession } from '../../session';
import type { ProjectStateBuilder } from '../../domain/project/projectStateBuilder';
import type { FormatOverrides } from '../../domain/formats';

export interface ProjectServiceDeps {
  session: ProjectSession;
  capabilities: Capabilities;
  editor: EditorPort;
  formats: FormatPort;
  projectState: ProjectStateBuilder;
  revision: {
    track: (snapshot: ReturnType<ProjectSession['snapshot']>) => string;
    hash: (snapshot: ReturnType<ProjectSession['snapshot']>) => string;
    get: (id: string) => ReturnType<ProjectSession['snapshot']> | null;
    remember: (snapshot: ReturnType<ProjectSession['snapshot']>, id: string) => void;
  };
  getSnapshot: () => ReturnType<ProjectSession['snapshot']>;
  ensureRevisionMatch: (ifRevision?: string) => ToolError | null;
  policies: {
    formatOverrides?: FormatOverrides;
    autoDiscardUnsaved?: boolean;
  };
}
