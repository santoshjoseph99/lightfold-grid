export type BenchmarkCategory =
  | 'specification'
  | 'coding'
  | 'testing'
  | 'review'
  | 'debugging'
  | 'repository-analysis';

export interface BenchmarkTask {
  id: string;
  category: BenchmarkCategory;
  description: string;
  validationRequired: boolean;
}

export interface BenchmarkModel {
  id: string;
  label: string;
  privacy: 'local' | 'cloud';
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
}

export interface BenchmarkOutcome {
  taskId: string;
  modelId: string;
  completed: boolean;
  validationPassed: boolean;
  latencyMs: number;
  retries: number;
  escalations: number;
  humanInterventions: number;
  promptTokens: number;
  completionTokens: number;
}

export interface BenchmarkConfiguration {
  id: string;
  label: string;
  assignments: Partial<Record<BenchmarkCategory, string>>;
}

export interface BenchmarkSuite {
  name: string;
  version: number;
  referenceGeneratedAt?: string;
  tasks: BenchmarkTask[];
  models: BenchmarkModel[];
  configurations: BenchmarkConfiguration[];
  outcomes: BenchmarkOutcome[];
  successThreshold: {
    mixedConfigurationId: string;
    baselineConfigurationId: string;
    minimumValidatedCompletionRate: number;
    maximumValidationRateDrop: number;
    minimumEstimatedCostReduction: number;
  };
}

export interface BenchmarkResult {
  configurationId: string;
  label: string;
  taskCount: number;
  completedTasks: number;
  validatedTasks: number;
  completionRate: number;
  validationPassRate: number;
  estimatedCostUsd: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  retries: number;
  escalations: number;
  humanInterventions: number;
  cloudAssignments: number;
  taskResults: Array<BenchmarkOutcome & { category: BenchmarkCategory; validationRequired: boolean; estimatedCostUsd: number }>;
}

export interface BenchmarkReport {
  suite: string;
  suiteVersion: number;
  generatedAt: string;
  results: BenchmarkResult[];
  comparison: {
    mixedConfigurationId: string;
    baselineConfigurationId: string;
    estimatedCostReduction: number;
    validationRateDrop: number;
    passesAlphaThreshold: boolean;
  };
}

const rounded = (value: number) => Number(value.toFixed(6));

export const validateBenchmarkSuite = (suite: BenchmarkSuite) => {
  if (!suite.name?.trim() || !Number.isInteger(suite.version) || suite.version < 1) {
    throw new Error('Benchmark suite requires a name and positive integer version.');
  }
  if (suite.tasks.length === 0 || suite.models.length === 0 || suite.configurations.length === 0) {
    throw new Error('Benchmark suite requires tasks, models, and configurations.');
  }
  const taskIds = new Set(suite.tasks.map((task) => task.id));
  const modelIds = new Set(suite.models.map((model) => model.id));
  const configurationIds = new Set(suite.configurations.map((configuration) => configuration.id));
  const outcomeIds = new Set(suite.outcomes.map((outcome) => `${outcome.taskId}:${outcome.modelId}`));
  if (
    taskIds.size !== suite.tasks.length ||
    modelIds.size !== suite.models.length ||
    configurationIds.size !== suite.configurations.length ||
    outcomeIds.size !== suite.outcomes.length
  ) {
    throw new Error('Benchmark task, model, configuration, and outcome IDs must be unique.');
  }
  const thresholdRates = [
    suite.successThreshold.minimumValidatedCompletionRate,
    suite.successThreshold.maximumValidationRateDrop,
    suite.successThreshold.minimumEstimatedCostReduction,
  ];
  if (thresholdRates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)) {
    throw new Error('Benchmark success threshold rates must be between zero and one.');
  }
  suite.configurations.forEach((configuration) => {
    suite.tasks.forEach((task) => {
      const modelId = configuration.assignments[task.category];
      if (!modelId || !modelIds.has(modelId)) {
        throw new Error(`Configuration ${configuration.id} has no valid model for ${task.category}.`);
      }
      if (!suite.outcomes.some((outcome) => outcome.taskId === task.id && outcome.modelId === modelId)) {
        throw new Error(`Missing outcome for ${task.id} on ${modelId}.`);
      }
    });
  });
  return suite;
};

export const runBenchmarkSuite = (
  suite: BenchmarkSuite,
  generatedAt = suite.referenceGeneratedAt || new Date().toISOString(),
): BenchmarkReport => {
  validateBenchmarkSuite(suite);
  const models = new Map(suite.models.map((model) => [model.id, model]));
  const outcomes = new Map(suite.outcomes.map((outcome) => [`${outcome.taskId}:${outcome.modelId}`, outcome]));
  const results = suite.configurations.map((configuration): BenchmarkResult => {
    const taskResults = suite.tasks.map((task) => {
      const modelId = configuration.assignments[task.category]!;
      const model = models.get(modelId)!;
      const outcome = outcomes.get(`${task.id}:${modelId}`)!;
      const estimatedCostUsd = rounded(
        (outcome.promptTokens / 1_000_000) * model.inputCostPerMillionTokens +
        (outcome.completionTokens / 1_000_000) * model.outputCostPerMillionTokens,
      );
      return { ...outcome, category: task.category, validationRequired: task.validationRequired, estimatedCostUsd };
    });
    const completedTasks = taskResults.filter((result) => result.completed).length;
    const validationTasks = taskResults.filter((result) => result.validationRequired);
    const validatedTasks = validationTasks.filter((result) => result.validationPassed).length;
    const totalLatencyMs = taskResults.reduce((sum, result) => sum + result.latencyMs, 0);
    return {
      configurationId: configuration.id,
      label: configuration.label,
      taskCount: taskResults.length,
      completedTasks,
      validatedTasks,
      completionRate: rounded(completedTasks / taskResults.length),
      validationPassRate: validationTasks.length === 0 ? 1 : rounded(validatedTasks / validationTasks.length),
      estimatedCostUsd: rounded(taskResults.reduce((sum, result) => sum + result.estimatedCostUsd, 0)),
      totalLatencyMs,
      averageLatencyMs: Math.round(totalLatencyMs / taskResults.length),
      retries: taskResults.reduce((sum, result) => sum + result.retries, 0),
      escalations: taskResults.reduce((sum, result) => sum + result.escalations, 0),
      humanInterventions: taskResults.reduce((sum, result) => sum + result.humanInterventions, 0),
      cloudAssignments: taskResults.filter((result) => models.get(result.modelId)!.privacy === 'cloud').length,
      taskResults,
    };
  });
  const threshold = suite.successThreshold;
  const mixed = results.find((result) => result.configurationId === threshold.mixedConfigurationId);
  const baseline = results.find((result) => result.configurationId === threshold.baselineConfigurationId);
  if (!mixed || !baseline) throw new Error('Benchmark success threshold references unknown configurations.');
  const estimatedCostReduction = baseline.estimatedCostUsd === 0
    ? 0
    : rounded((baseline.estimatedCostUsd - mixed.estimatedCostUsd) / baseline.estimatedCostUsd);
  const validationRateDrop = rounded(baseline.validationPassRate - mixed.validationPassRate);
  return {
    suite: suite.name,
    suiteVersion: suite.version,
    generatedAt,
    results,
    comparison: {
      mixedConfigurationId: mixed.configurationId,
      baselineConfigurationId: baseline.configurationId,
      estimatedCostReduction,
      validationRateDrop,
      passesAlphaThreshold:
        mixed.validationPassRate >= threshold.minimumValidatedCompletionRate &&
        validationRateDrop <= threshold.maximumValidationRateDrop &&
        estimatedCostReduction >= threshold.minimumEstimatedCostReduction,
    },
  };
};

export const formatBenchmarkMarkdown = (report: BenchmarkReport) => {
  const rows = report.results.map((result) =>
    `| ${result.label} | ${(result.completionRate * 100).toFixed(1)}% | ${(result.validationPassRate * 100).toFixed(1)}% | $${result.estimatedCostUsd.toFixed(4)} | ${result.averageLatencyMs}ms | ${result.retries} | ${result.escalations} | ${result.humanInterventions} |`,
  );
  return [
    `# ${report.suite} Results`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Configuration | Completion | Validation | Est. cost | Avg. latency | Retries | Escalations | Human interventions |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `Mixed-model estimated cost reduction: ${(report.comparison.estimatedCostReduction * 100).toFixed(1)}%`,
    '',
    `Mixed-model validation-rate drop: ${(report.comparison.validationRateDrop * 100).toFixed(1)} percentage points`,
    '',
    `Reference alpha threshold: ${report.comparison.passesAlphaThreshold ? 'PASS' : 'FAIL'}`,
    '',
  ].join('\n');
};
