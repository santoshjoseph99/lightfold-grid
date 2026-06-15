import type { BenchmarkCategory, BenchmarkConfiguration, BenchmarkModel } from './benchmark.ts';

export type LiveBenchmarkProvenance = 'fixture' | 'live';

export interface LiveBenchmarkTask {
  id: string;
  category: BenchmarkCategory;
  description: string;
  repositoryId: string;
  promptId: string;
  validationRequired: boolean;
}

export interface LiveBenchmarkRepository {
  id: string;
  url: string;
  commit: string;
}

export interface LiveBenchmarkPromptSet {
  id: string;
  version: string;
  path: string;
  sha256: string;
}

export interface LiveBenchmarkModel extends BenchmarkModel {
  provider: string;
  modelVersion: string;
  pricingRetrievedAt: string;
}

export interface LiveBenchmarkRun {
  id: string;
  configurationId: string;
  repetition: number;
  taskId: string;
  modelId: string;
  startedAt: string;
  finishedAt: string;
  completed: boolean;
  validationPassed: boolean;
  latencyMs: number;
  retries: number;
  escalations: number;
  humanInterventions: number;
  promptTokens: number;
  completionTokens: number;
  evidencePath: string;
  evidenceRecordId: string;
  evidenceSha256: string;
}

export interface LiveBenchmarkCampaign {
  kind: 'lightfold-live-benchmark';
  schemaVersion: 1;
  provenance: LiveBenchmarkProvenance;
  id: string;
  label: string;
  collectedAt: string;
  repetitions: number;
  repositories: LiveBenchmarkRepository[];
  promptSets: LiveBenchmarkPromptSet[];
  tasks: LiveBenchmarkTask[];
  models: LiveBenchmarkModel[];
  configurations: BenchmarkConfiguration[];
  runs: LiveBenchmarkRun[];
  comparison: {
    mixedConfigurationId: string;
    baselineConfigurationId: string;
  };
}

export interface LiveBenchmarkConfigurationResult {
  configurationId: string;
  label: string;
  runCount: number;
  completionRate: number;
  validationPassRate: number;
  averageEstimatedCostUsd: number;
  averageLatencyMs: number;
  retries: number;
  escalations: number;
  humanInterventions: number;
  cloudAssignments: number;
}

export interface LiveBenchmarkReport {
  campaignId: string;
  label: string;
  provenance: LiveBenchmarkProvenance;
  collectedAt: string;
  repetitions: number;
  results: LiveBenchmarkConfigurationResult[];
  comparison: {
    mixedConfigurationId: string;
    baselineConfigurationId: string;
    estimatedCostReduction: number;
    validationRateDrop: number;
  };
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{7,40}$/i;
const isTimestamp = (value: string) => Number.isFinite(Date.parse(value));
const isSafeRelativePath = (value: string) =>
  Boolean(value) &&
  !value.startsWith('/') &&
  !value.startsWith('\\') &&
  !/^[a-z]:[\\/]/i.test(value) &&
  !value.split(/[\\/]/).includes('..');
const rounded = (value: number) => Number(value.toFixed(6));

const requireUnique = (values: string[], label: string) => {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
};

export const validateLiveBenchmarkCampaign = (
  campaign: LiveBenchmarkCampaign,
  options: { requireLive?: boolean } = {},
) => {
  if (campaign.kind !== 'lightfold-live-benchmark' || campaign.schemaVersion !== 1) {
    throw new Error('Live benchmark requires the supported kind and schema version.');
  }
  if (options.requireLive && campaign.provenance !== 'live') {
    throw new Error('Publishable benchmark evidence must have live provenance.');
  }
  if (!campaign.id?.trim() || !campaign.label?.trim() || !isTimestamp(campaign.collectedAt)) {
    throw new Error('Live benchmark requires an ID, label, and valid collection timestamp.');
  }
  if (!Number.isInteger(campaign.repetitions) || campaign.repetitions < 3) {
    throw new Error('Live benchmark campaigns require at least three repetitions.');
  }
  if (
    campaign.repositories.length === 0 ||
    campaign.promptSets.length === 0 ||
    campaign.tasks.length === 0 ||
    campaign.models.length === 0 ||
    campaign.configurations.length < 2
  ) {
    throw new Error('Live benchmark requires repositories, prompts, tasks, models, and at least two configurations.');
  }

  requireUnique(campaign.repositories.map((repository) => repository.id), 'Repository IDs');
  requireUnique(campaign.promptSets.map((prompt) => prompt.id), 'Prompt-set IDs');
  requireUnique(campaign.tasks.map((task) => task.id), 'Task IDs');
  requireUnique(campaign.models.map((model) => model.id), 'Model IDs');
  requireUnique(campaign.configurations.map((configuration) => configuration.id), 'Configuration IDs');
  requireUnique(campaign.runs.map((run) => run.id), 'Run IDs');
  requireUnique(campaign.runs.map((run) => run.evidenceRecordId), 'Evidence record IDs');

  const repositoryIds = new Set(campaign.repositories.map((repository) => repository.id));
  const promptIds = new Set(campaign.promptSets.map((prompt) => prompt.id));
  const taskIds = new Set(campaign.tasks.map((task) => task.id));
  const modelIds = new Set(campaign.models.map((model) => model.id));
  const configurationIds = new Set(campaign.configurations.map((configuration) => configuration.id));

  campaign.repositories.forEach((repository) => {
    if (!repository.url?.trim() || !commitPattern.test(repository.commit)) {
      throw new Error(`Repository ${repository.id} requires a URL and pinned commit.`);
    }
  });
  campaign.promptSets.forEach((prompt) => {
    if (!prompt.version?.trim() || !isSafeRelativePath(prompt.path) || !sha256Pattern.test(prompt.sha256)) {
      throw new Error(`Prompt set ${prompt.id} requires a version, safe artifact path, and SHA-256 digest.`);
    }
  });
  campaign.models.forEach((model) => {
    if (
      !model.provider?.trim() ||
      !model.modelVersion?.trim() ||
      !isTimestamp(model.pricingRetrievedAt) ||
      [model.inputCostPerMillionTokens, model.outputCostPerMillionTokens].some((cost) => !Number.isFinite(cost) || cost < 0)
    ) {
      throw new Error(`Model ${model.id} requires pinned provider, version, and pricing metadata.`);
    }
  });
  campaign.tasks.forEach((task) => {
    if (!repositoryIds.has(task.repositoryId) || !promptIds.has(task.promptId)) {
      throw new Error(`Task ${task.id} references an unknown repository or prompt set.`);
    }
  });
  campaign.configurations.forEach((configuration) => {
    campaign.tasks.forEach((task) => {
      const modelId = configuration.assignments[task.category];
      if (!modelId || !modelIds.has(modelId)) {
        throw new Error(`Configuration ${configuration.id} has no valid model for ${task.category}.`);
      }
    });
  });
  if (
    !configurationIds.has(campaign.comparison.mixedConfigurationId) ||
    !configurationIds.has(campaign.comparison.baselineConfigurationId)
  ) {
    throw new Error('Live benchmark comparison references unknown configurations.');
  }
  if (campaign.comparison.mixedConfigurationId === campaign.comparison.baselineConfigurationId) {
    throw new Error('Live benchmark comparison requires distinct configurations.');
  }

  const runKeys = new Set<string>();
  campaign.runs.forEach((run) => {
    const configuration = campaign.configurations.find((candidate) => candidate.id === run.configurationId);
    const task = campaign.tasks.find((candidate) => candidate.id === run.taskId);
    if (!configuration || !task || !modelIds.has(run.modelId)) {
      throw new Error(`Run ${run.id} references an unknown configuration, task, or model.`);
    }
    if (configuration.assignments[task.category] !== run.modelId) {
      throw new Error(`Run ${run.id} model does not match its configuration assignment.`);
    }
    if (!Number.isInteger(run.repetition) || run.repetition < 1 || run.repetition > campaign.repetitions) {
      throw new Error(`Run ${run.id} has an invalid repetition.`);
    }
    if (!isTimestamp(run.startedAt) || !isTimestamp(run.finishedAt) || Date.parse(run.finishedAt) < Date.parse(run.startedAt)) {
      throw new Error(`Run ${run.id} has invalid timestamps.`);
    }
    if (
      [run.latencyMs, run.retries, run.escalations, run.humanInterventions, run.promptTokens, run.completionTokens]
        .some((value) => !Number.isFinite(value) || value < 0)
    ) {
      throw new Error(`Run ${run.id} has invalid outcome metrics.`);
    }
    if (run.validationPassed && !run.completed) {
      throw new Error(`Run ${run.id} cannot pass validation without completing.`);
    }
    if (!isSafeRelativePath(run.evidencePath) || !run.evidenceRecordId?.trim() || !sha256Pattern.test(run.evidenceSha256)) {
      throw new Error(`Run ${run.id} requires a safe raw-evidence path, record ID, and SHA-256 digest.`);
    }
    const key = `${run.configurationId}:${run.taskId}:${run.repetition}`;
    if (runKeys.has(key)) throw new Error(`Duplicate live benchmark run ${key}.`);
    runKeys.add(key);
  });

  campaign.configurations.forEach((configuration) => {
    campaign.tasks.forEach((task) => {
      for (let repetition = 1; repetition <= campaign.repetitions; repetition += 1) {
        const key = `${configuration.id}:${task.id}:${repetition}`;
        if (!runKeys.has(key)) throw new Error(`Missing live benchmark run ${key}.`);
      }
    });
  });
  if (campaign.runs.length !== runKeys.size) throw new Error('Live benchmark contains unexpected runs.');
  return campaign;
};

export const summarizeLiveBenchmarkCampaign = (campaign: LiveBenchmarkCampaign): LiveBenchmarkReport => {
  validateLiveBenchmarkCampaign(campaign);
  const models = new Map(campaign.models.map((model) => [model.id, model]));
  const tasks = new Map(campaign.tasks.map((task) => [task.id, task]));
  const results = campaign.configurations.map((configuration): LiveBenchmarkConfigurationResult => {
    const runs = campaign.runs.filter((run) => run.configurationId === configuration.id);
    const validationRuns = runs.filter((run) => tasks.get(run.taskId)!.validationRequired);
    const totalCost = runs.reduce((sum, run) => {
      const model = models.get(run.modelId)!;
      return sum +
        (run.promptTokens / 1_000_000) * model.inputCostPerMillionTokens +
        (run.completionTokens / 1_000_000) * model.outputCostPerMillionTokens;
    }, 0);
    return {
      configurationId: configuration.id,
      label: configuration.label,
      runCount: runs.length,
      completionRate: rounded(runs.filter((run) => run.completed).length / runs.length),
      validationPassRate: validationRuns.length === 0
        ? 1
        : rounded(validationRuns.filter((run) => run.validationPassed).length / validationRuns.length),
      averageEstimatedCostUsd: rounded(totalCost / campaign.repetitions),
      averageLatencyMs: Math.round(runs.reduce((sum, run) => sum + run.latencyMs, 0) / runs.length),
      retries: runs.reduce((sum, run) => sum + run.retries, 0),
      escalations: runs.reduce((sum, run) => sum + run.escalations, 0),
      humanInterventions: runs.reduce((sum, run) => sum + run.humanInterventions, 0),
      cloudAssignments: runs.filter((run) => models.get(run.modelId)!.privacy === 'cloud').length,
    };
  });
  const mixed = results.find((result) => result.configurationId === campaign.comparison.mixedConfigurationId)!;
  const baseline = results.find((result) => result.configurationId === campaign.comparison.baselineConfigurationId)!;
  return {
    campaignId: campaign.id,
    label: campaign.label,
    provenance: campaign.provenance,
    collectedAt: campaign.collectedAt,
    repetitions: campaign.repetitions,
    results,
    comparison: {
      mixedConfigurationId: mixed.configurationId,
      baselineConfigurationId: baseline.configurationId,
      estimatedCostReduction: baseline.averageEstimatedCostUsd === 0
        ? 0
        : rounded((baseline.averageEstimatedCostUsd - mixed.averageEstimatedCostUsd) / baseline.averageEstimatedCostUsd),
      validationRateDrop: rounded(baseline.validationPassRate - mixed.validationPassRate),
    },
  };
};

export const formatLiveBenchmarkMarkdown = (report: LiveBenchmarkReport) => [
  `# ${report.label}`,
  '',
  report.provenance === 'live'
    ? '**LIVE EVIDENCE:** Results summarize a provenance-validated live campaign.'
    : '**FIXTURE ONLY:** These declared outcomes validate the evidence pipeline and are not model-performance claims.',
  '',
  `Campaign: ${report.campaignId}`,
  '',
  `Collected: ${report.collectedAt}`,
  '',
  `Repetitions: ${report.repetitions}`,
  '',
  '| Configuration | Runs | Completion | Validation | Avg. cost/run set | Avg. latency | Retries | Escalations | Human interventions | Cloud assignments |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...report.results.map((result) =>
    `| ${result.label} | ${result.runCount} | ${(result.completionRate * 100).toFixed(1)}% | ${(result.validationPassRate * 100).toFixed(1)}% | $${result.averageEstimatedCostUsd.toFixed(4)} | ${result.averageLatencyMs}ms | ${result.retries} | ${result.escalations} | ${result.humanInterventions} | ${result.cloudAssignments} |`,
  ),
  '',
  `Mixed-model estimated cost reduction: ${(report.comparison.estimatedCostReduction * 100).toFixed(1)}%`,
  '',
  `Mixed-model validation-rate drop: ${(report.comparison.validationRateDrop * 100).toFixed(1)} percentage points`,
  '',
].join('\n');
