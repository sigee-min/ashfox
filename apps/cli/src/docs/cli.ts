import { BuildFailure } from '@ashfox/asset-build';
import { formatDidYouMean } from '@ashfox/engine-core';
import { formatCliResult } from '../onboarding/cli';
import {
  DOCS_TOPICS,
  DOCS_TOPIC_IDS,
  findDocsTopic,
  readDocsMarkdown,
  type DocsTopicEntry,
} from './catalog';

interface DocsArgs {
  readonly topic?: string;
  readonly json: boolean;
}

const parseDocsArgs = (args: readonly string[]): DocsArgs => {
  let json = false;
  const positionals: string[] = [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--json') {
      if (json) throw new BuildFailure('cli.arguments', 'Duplicate --json', 2);
      json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new BuildFailure('cli.arguments', `Unknown option "${arg}" for ashfox docs`, 2);
    }
    positionals.push(arg);
  }
  if (positionals.length > 1) {
    throw new BuildFailure('cli.arguments', 'Usage: ashfox docs [topic] [--json]', 2);
  }
  return { topic: positionals[0], json };
};

const formatTopicIndexText = (topics: readonly DocsTopicEntry[]): string => {
  const width = Math.max(...topics.map((t) => t.topic.length), 10);
  const lines = [
    'Ashfox Documentation Topics:',
    '',
    ...topics.map((t) => `  ${t.topic.padEnd(width + 2)}${t.description}`),
    '',
    'Run: ashfox docs <topic> [--json]',
    '',
  ];
  return lines.join('\n');
};

export const runDocsCommand = (args: readonly string[]): void => {
  const parsed = parseDocsArgs(args);
  if (!parsed.topic) {
    if (parsed.json) {
      process.stdout.write(formatCliResult('docs', true, { topics: DOCS_TOPICS }));
    } else {
      process.stdout.write(formatTopicIndexText(DOCS_TOPICS));
    }
    return;
  }
  const entry = findDocsTopic(parsed.topic);
  if (!entry) {
    const suggestion = formatDidYouMean(parsed.topic, DOCS_TOPIC_IDS);
    throw new BuildFailure(
      'docs.unknown-topic',
      `Unknown docs topic "${parsed.topic}".${suggestion}`,
      2,
      undefined,
      "Hint: run 'ashfox docs'",
    );
  }
  const markdown = readDocsMarkdown(entry.topic);
  if (markdown === null) {
    throw new BuildFailure(
      'docs.unavailable',
      `Bundled documentation is unavailable for "${entry.topic}".`,
      3,
    );
  }
  if (parsed.json) {
    process.stdout.write(
      formatCliResult('docs', true, {
        topic: entry.topic,
        title: entry.title,
        description: entry.description,
        source: entry.source,
        markdown,
      }),
    );
    return;
  }
  process.stdout.write(markdown.endsWith('\n') ? markdown : `${markdown}\n`);
};
