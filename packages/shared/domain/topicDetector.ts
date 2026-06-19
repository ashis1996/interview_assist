// Topic_Detector (pure). Relocated verbatim from v1 src/main/domain.
//
// Deterministic keyword/lexicon classifier that maps a finalized question's
// text to zero or more IT topic domains (Req 14.1). The classifier is a pure
// function with no side effects: the same input always yields the same output.

import { TOPIC_DOMAINS, type TopicDomain } from '../types'

/**
 * Curated lexicon mapping each supported {@link TopicDomain} to a set of
 * representative lowercase keywords/phrases. Keywords are matched
 * case-insensitively with token-boundary awareness (see {@link detectTopics})
 * so that, for example, `oop` does not match inside `loop`.
 */
export const TOPIC_KEYWORDS: Record<TopicDomain, readonly string[]> = {
  'software-development': [
    'function',
    'class',
    'api',
    'refactor',
    'algorithm',
    'code',
    'coding',
    'programming',
    'design pattern',
    'oop',
    'recursion',
    'data structure',
  ],
  databases: [
    'sql',
    'index',
    'query',
    'transaction',
    'join',
    'normalization',
    'postgres',
    'postgresql',
    'mysql',
    'nosql',
    'mongodb',
    'foreign key',
  ],
  'system-design': [
    'scalability',
    'load balancer',
    'throughput',
    'latency',
    'distributed system',
    'caching',
    'partition',
    'sharding',
    'rate limiting',
    'high availability',
  ],
  devops: [
    'ci/cd',
    'pipeline',
    'docker',
    'kubernetes',
    'deployment',
    'jenkins',
    'terraform',
    'container',
    'ansible',
    'helm',
  ],
  cloud: [
    'aws',
    'azure',
    'gcp',
    's3',
    'lambda',
    'cloud',
    'ec2',
    'serverless',
    'cloudformation',
    'iam',
  ],
  linux: [
    'linux',
    'bash',
    'kernel',
    'systemd',
    'unix',
    'shell',
    'permissions',
    'cron',
    'chmod',
    'grep',
  ],
  monitoring: [
    'prometheus',
    'grafana',
    'metrics',
    'alerting',
    'observability',
    'logging',
    'tracing',
    'dashboard',
    'telemetry',
  ],
  'qa-testing': [
    'test',
    'qa',
    'unit test',
    'integration test',
    'selenium',
    'coverage',
    'assertion',
    'regression',
    'mocking',
    'test case',
  ],
  architecture: [
    'architecture',
    'microservices',
    'monolith',
    'bounded context',
    'event-driven',
    'hexagonal',
    'domain-driven',
    'clean architecture',
  ],
  management: [
    'team',
    'stakeholder',
    'roadmap',
    'agile',
    'scrum',
    'leadership',
    'planning',
    'mentoring',
    'one-on-one',
    'sprint',
  ],
  'data-engineering': [
    'etl',
    'spark',
    'data pipeline',
    'kafka',
    'data warehouse',
    'airflow',
    'batch',
    'streaming',
    'data lake',
    'hadoop',
  ],
  security: [
    'security',
    'encryption',
    'authentication',
    'authorization',
    'vulnerability',
    'oauth',
    'tls',
    'xss',
    'penetration',
    'csrf',
    'sql injection',
  ],
}

/** Escapes characters that have special meaning in a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds a deterministic, case-insensitive matcher for a single keyword,
 * bounded by negative look-arounds so it does not match inside a larger
 * alphanumeric token.
 */
function keywordPattern(keyword: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`)
}

const COMPILED_MATCHERS: ReadonlyArray<{ domain: TopicDomain; matchers: RegExp[] }> =
  TOPIC_DOMAINS.map((domain) => ({
    domain,
    matchers: TOPIC_KEYWORDS[domain].map(keywordPattern),
  }))

/**
 * Classifies the given question text into zero or more IT topic domains.
 * Deduplicated and ordered to follow the canonical {@link TOPIC_DOMAINS} order.
 *
 * @param questionText - The finalized question to classify.
 * @returns A deduplicated, deterministically ordered list of matched topic domains.
 */
export function detectTopics(questionText: string): TopicDomain[] {
  if (typeof questionText !== 'string' || questionText.length === 0) {
    return []
  }

  const haystack = questionText.toLowerCase()
  const matched: TopicDomain[] = []

  for (const { domain, matchers } of COMPILED_MATCHERS) {
    if (matchers.some((matcher) => matcher.test(haystack))) {
      matched.push(domain)
    }
  }

  return matched
}
