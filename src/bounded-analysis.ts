import type { Evidence, Contract } from './domain';

type AnalysisResult = {
  status: 'SUPPORTED' | 'CONCERN' | 'UNVERIFIED';
  evidenceIds: string[];
  assessment: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  limit: string;
};

type BoundedAnalysisInput = {
  contract: Contract;
  evidence: Evidence[];
  diff?: string;
  changedFiles?: string[];
  changedSymbols?: string[];
  repositoryIndex?: Record<string, string[]>;
  imports?: Record<string, string[]>;
  exports?: Record<string, string[]>;
};

/** Failed or missing outcomes never support a positive functional assessment. */
function executionLimit(evidence: Evidence[]): AnalysisResult | null {
  const failed = evidence.filter((e) => e.status === 'FAIL');
  if (failed.length)
    return {
      status: 'CONCERN',
      evidenceIds: failed.map((e) => e.id),
      assessment:
        'Relevant execution checks failed; behavior is not established as working',
      confidence: 'HIGH',
      limit:
        'Failure applies only to the cited execution scope; inspect root cause',
    };
  const unknown = evidence.filter((e) => e.status !== 'PASS');
  if (unknown.length)
    return {
      status: 'UNVERIFIED',
      evidenceIds: unknown.map((e) => e.id),
      assessment: 'Relevant execution checks lack verified passing outcomes',
      confidence: 'LOW',
      limit: 'Execute scoped checks before assessing behavior',
    };
  return null;
}

/**
 * Bounded evidence-backed analysis for semantic review facets.
 * Uses deterministic evidence (diff, symbols, scans, tests) to produce
 * engineering assessments. Results may be UNVERIFIED if evidence is insufficient,
 * but the capability itself is implemented and tested.
 */

export function analyzeSymptomMasking(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { contract, evidence, diff, changedFiles, changedSymbols } = input;

  // Look for evidence of root cause vs symptom masking
  const testEvidence = evidence.filter(
    (e) => e.kind === 'execution' && e.criterionId,
  );
  const outcomeLimit = executionLimit(testEvidence);
  if (outcomeLimit) return outcomeLimit;
  const regressionEvidence = evidence.filter(
    (e) => e.status === 'FAIL' && e.baselineStatus === 'PASS',
  );
  const narrowGuardChanges = diff?.match(
    /(if|guard|check|validate).*return.*null|undefined|false|empty/gi,
  );
  const constantSpecialCases = diff?.match(
    /(case|when).*===.*['"](?:true|false|null|undefined)['"]/gi,
  );

  const concerns: string[] = [];
  const relevantEvidence: string[] = [];

  if (narrowGuardChanges && narrowGuardChanges.length > 0) {
    concerns.push(
      'Narrow guard conditions detected that may bypass root cause',
    );
  }

  if (constantSpecialCases && constantSpecialCases.length > 0) {
    concerns.push(
      'Constant special-case conditions that may mask underlying issue',
    );
  }

  if (regressionEvidence.length > 0) {
    concerns.push(
      'Baseline regression detected; verify fix addresses root cause',
    );
    relevantEvidence.push(...regressionEvidence.map((e) => e.id));
  }

  if (testEvidence.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment:
        'Insufficient test evidence to distinguish root cause from symptom masking',
      confidence: 'LOW',
      limit: 'Requires test coverage for negative cases and edge conditions',
    };
  }

  if (!diff)
    return {
      status: 'UNVERIFIED',
      evidenceIds: testEvidence.map((e) => e.id),
      assessment: 'No scoped source diff available to assess symptom masking',
      confidence: 'LOW',
      limit: 'Passing checks alone do not establish root-cause resolution',
    };

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: testEvidence.map((e) => e.id),
      assessment:
        'No obvious symptom masking patterns detected; implementation addresses test cases',
      confidence: 'MEDIUM',
      limit:
        'Analysis based on diff patterns and test coverage; deeper semantic understanding requires human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [...testEvidence.map((e) => e.id), ...relevantEvidence],
    assessment: `Potential symptom masking: ${concerns.join('; ')}. Verify implementation addresses root cause requirement.`,
    confidence: 'MEDIUM',
    limit: 'Pattern-based detection; actual intent requires human review',
  };
}

export function analyzeDuplication(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { diff, changedFiles, changedSymbols } = input;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for duplication analysis',
      confidence: 'LOW',
      limit: 'Requires diff to detect duplicate code patterns',
    };
  }

  // Simple bounded duplication detection in changed files
  const concerns: string[] = [];
  const lines = diff.split('\n');
  const addedLines = lines.filter(
    (l) => l.startsWith('+') && !l.startsWith('+++'),
  );
  const lineGroups = new Map<string, number>();

  addedLines.forEach((line) => {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (normalized.length > 10) {
      lineGroups.set(normalized, (lineGroups.get(normalized) || 0) + 1);
    }
  });

  const duplicates = Array.from(lineGroups.entries())
    .filter(([_, count]) => count > 2)
    .map(([line, _]) => line);

  if (duplicates.length > 0) {
    concerns.push(`${duplicates.length} repeated code blocks detected in diff`);
  }

  // Check for duplicate function/class names
  if (changedSymbols) {
    const symbolCounts = new Map<string, number>();
    changedSymbols.forEach((s) => {
      symbolCounts.set(s, (symbolCounts.get(s) || 0) + 1);
    });
    const duplicateSymbols = Array.from(symbolCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([s, _]) => s);

    if (duplicateSymbols.length > 0) {
      concerns.push(
        `Duplicate symbol definitions: ${duplicateSymbols.join(', ')}`,
      );
    }
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'No obvious duplication detected in changed code',
      confidence: 'MEDIUM',
      limit:
        'Analysis limited to diff and symbol changes; repository-wide clone detection not performed',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Duplication concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Bounded detection within diff; may miss duplication across unchanged files',
  };
}

export function analyzeNoPrivateIntentions(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { diff, changedFiles } = input;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available to check for intention claims',
      confidence: 'LOW',
      limit: 'Requires diff to detect intention assertions',
    };
  }

  // Check for intention-related keywords in comments or prose
  const intentionPatterns = [
    /intentionally/i,
    /by design/i,
    /meant to/i,
    /supposed to/i,
    /intended behavior/i,
  ];

  const lines = diff.split('\n');
  const concerns: string[] = [];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      intentionPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Potential intention claim in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment:
        'No explicit private intention claims detected in code changes',
      confidence: 'HIGH',
      limit:
        'Pattern-based detection on diff; sophisticated intention inference is explicitly avoided',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Potential intention claims detected: ${concerns.join('; ')}. Private intentions should not be asserted from code or prose.`,
    confidence: 'MEDIUM',
    limit:
      'Pattern detection; actual intent inference requires human interpretation',
  };
}

export function analyzeSeparationOfConcerns(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { changedFiles, imports, exports } = input;

  if (!changedFiles || changedFiles.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No changed files available for separation analysis',
      confidence: 'LOW',
      limit: 'Requires changed file list to analyze module boundaries',
    };
  }

  if (
    !imports ||
    changedFiles.some((file) => !Object.hasOwn(imports, file)) ||
    !exports ||
    changedFiles.some((file) => !Object.hasOwn(exports, file))
  )
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'Scoped module inventory is missing for changed files',
      confidence: 'LOW',
      limit:
        'Requires actual import/export inventory; file presence is context only',
    };

  const concerns: string[] = [];

  // Check for files with many different responsibilities
  changedFiles.forEach((file) => {
    const fileImports = imports?.[file] || [];
    const fileExports = exports?.[file] || [];

    // If a file imports from many different domains, may have mixed concerns
    const importDomains = new Set(fileImports.map((i) => i.split('/')[0]));
    if (importDomains.size > 5) {
      concerns.push(
        `${file} imports from ${importDomains.size} different domains, suggesting mixed concerns`,
      );
    }

    // If a file exports many different types of symbols
    const exportTypes = new Set(
      fileExports.map((e) => {
        if (e.includes('class')) return 'class';
        if (e.includes('function') || e.includes('=>')) return 'function';
        if (e.includes('const') || e.includes('let')) return 'variable';
        return 'unknown';
      }),
    );
    if (exportTypes.size > 3) {
      concerns.push(
        `${file} exports multiple symbol types, suggesting mixed responsibilities`,
      );
    }
  });

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'Changed files appear to maintain separation of concerns',
      confidence: 'MEDIUM',
      limit:
        'Analysis based on import/export patterns; actual semantic separation requires human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Separation of concerns issues: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; architectural judgment requires human interpretation',
  };
}

export function analyzeErrorHandling(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { diff, evidence } = input;

  const errorTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('error') ||
        e.criterionId?.includes('fail') ||
        e.criterionId?.includes('exception')),
  );
  const outcomeLimit = executionLimit(errorTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for error handling analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect error paths',
    };
  }

  const lines = diff.split('\n');
  const addedTryCatch = lines.filter(
    (l) => l.startsWith('+') && /\btry\s*{/.test(l),
  );
  const addedErrorPaths = lines.filter(
    (l) => l.startsWith('+') && /\b(catch|error|throw|finally)\b/i.test(l),
  );
  const addedSilentErrors = lines.filter(
    (l) => l.startsWith('+') && /\bcatch\s*\([^)]*\)\s*{\s*}/.test(l),
  );

  const concerns: string[] = [];

  if (addedSilentErrors.length > 0) {
    concerns.push(
      `${addedSilentErrors.length} silent error catch blocks detected`,
    );
  }

  if (addedTryCatch.length > 0 && addedErrorPaths.length === 0) {
    concerns.push('Try-catch blocks without visible error handling logic');
  }

  if (errorTestEvidence.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment:
        'No error-specific test evidence available to validate error handling',
      confidence: 'LOW',
      limit: 'Requires error-specific test coverage to verify error paths',
    };
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: errorTestEvidence.map((e) => e.id),
      assessment:
        'Error handling appears appropriate; error-specific tests exist',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual error handling quality requires human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: errorTestEvidence.map((e) => e.id),
    assessment: `Error handling concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; silent errors may be intentional in some contexts',
  };
}

export function analyzeNaming(input: BoundedAnalysisInput): AnalysisResult {
  const { changedSymbols, diff } = input;

  if (!changedSymbols || changedSymbols.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No changed symbols available for naming analysis',
      confidence: 'LOW',
      limit: 'Requires changed symbol list to evaluate naming',
    };
  }

  const concerns: string[] = [];

  // Check for obvious naming issues
  changedSymbols.forEach((symbol) => {
    // Very short names (except common ones)
    if (
      symbol.length < 3 &&
      !['i', 'j', 'k', 'x', 'y', 'z', 'a', 'b'].includes(symbol)
    ) {
      concerns.push(`Very short symbol name: ${symbol}`);
    }

    // Non-ASCII or special characters (excluding allowed patterns)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(symbol)) {
      concerns.push(`Non-standard naming pattern: ${symbol}`);
    }

    // Inconsistent casing (camelCase vs snake_case)
    if (symbol.includes('_') && /[A-Z]/.test(symbol)) {
      concerns.push(`Mixed snake_case and camelCase: ${symbol}`);
    }
  });

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'Changed symbols follow standard naming conventions',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; semantic naming quality requires human judgment',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Naming concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; naming style conventions vary by language/team',
  };
}

export function analyzeAPIDesign(input: BoundedAnalysisInput): AnalysisResult {
  const { exports, diff, evidence } = input;

  const apiTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('api') ||
        e.criterionId?.includes('interface') ||
        e.criterionId?.includes('compatibility')),
  );
  const outcomeLimit = executionLimit(apiTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!exports || Object.keys(exports).length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No export information available for API design analysis',
      confidence: 'LOW',
      limit: 'Requires export inventory to analyze API design',
    };
  }

  const concerns: string[] = [];

  // Check for API changes
  Object.entries(exports).forEach(([file, exported]) => {
    exported.forEach((exp) => {
      // Very long function signatures
      if (exp.length > 200) {
        concerns.push(
          `Long API signature in ${file}: ${exp.substring(0, 50)}...`,
        );
      }

      // Many parameters (simple heuristic)
      const paramCount = (exp.match(/,/g) || []).length;
      if (paramCount > 7) {
        concerns.push(
          `High parameter count in ${file}: ${exp.substring(0, 50)}...`,
        );
      }
    });
  });

  if (apiTestEvidence.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment:
        'No API-specific test evidence available to validate API design',
      confidence: 'LOW',
      limit: 'Requires API compatibility or interface tests to verify design',
    };
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: apiTestEvidence.map((e) => e.id),
      assessment: 'API design appears reasonable; API-specific tests exist',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual API quality requires human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: apiTestEvidence.map((e) => e.id),
    assessment: `API design concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; API design involves tradeoffs that require human judgment',
  };
}

export function analyzeTechnicalDebt(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { diff, evidence } = input;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for technical debt analysis',
      confidence: 'LOW',
      limit: 'Requires diff to detect technical debt indicators',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for common technical debt markers
  const debtPatterns = [
    /TODO/i,
    /FIXME/i,
    /HACK/i,
    /XXX/i,
    /TEMPORARY/i,
    /QUICK FIX/i,
    /WORKAROUND/i,
    /DISABLED.*CHECK/i,
    /@ts-ignore/i,
    /@ts-expect-error/i,
    /any/i,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      debtPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Technical debt marker in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  // Check for lint/typecheck failures
  const lintFailures = evidence.filter(
    (e) => e.kind === 'source' && e.status === 'FAIL',
  );
  if (lintFailures.length > 0) {
    concerns.push(`${lintFailures.length} lint/typecheck failures present`);
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'No obvious technical debt markers detected in changes',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; technical debt may exist in unchanged code or not be marked',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: lintFailures.map((e) => e.id),
    assessment: `Technical debt indicators: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; some technical debt may be intentional or acceptable',
  };
}

export function analyzeTestability(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, changedFiles } = input;

  const testEvidence = evidence.filter(
    (e) => e.kind === 'execution' && e.criterionId?.includes('test'),
  );
  const outcomeLimit = executionLimit(testEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!changedFiles || changedFiles.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No changed files available for testability analysis',
      confidence: 'LOW',
      limit: 'Requires changed file list to evaluate test coverage',
    };
  }

  const concerns: string[] = [];

  // Check if changed files have corresponding tests
  const testFiles = changedFiles.filter(
    (f) => f.includes('.test.') || f.includes('.spec.'),
  );
  const nonTestFiles = changedFiles.filter(
    (f) => !f.includes('.test.') && !f.includes('.spec.'),
  );

  if (nonTestFiles.length > 0 && testFiles.length === 0) {
    concerns.push('Code changes without corresponding test changes');
  }

  if (testEvidence.length === 0) {
    concerns.push('No test execution evidence available');
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: testEvidence.map((e) => e.id),
      assessment: 'Testability appears adequate; tests exist',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual test quality requires human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: testEvidence.map((e) => e.id),
    assessment: `Testability concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; test coverage does not guarantee test quality',
  };
}

export function analyzeHardcodedSecrets(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, diff } = input;

  const secretEvidence = evidence.filter(
    (e) =>
      e.kind === 'source' &&
      (e.criterionId?.includes('secret') ||
        e.criterionId?.includes('credential')),
  );

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for secret analysis',
      confidence: 'LOW',
      limit: 'Requires diff to detect hardcoded secrets',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for suspicious patterns in added lines
  const secretPatterns = [
    /password\s*=\s*['"][^'"]+['"]/i,
    /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
    /secret\s*=\s*['"][^'"]+['"]/i,
    /token\s*=\s*['"][^'"]+['"]/i,
    /auth\s*=\s*['"][^'"]+['"]/i,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      secretPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Potential hardcoded secret in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  if (secretEvidence.length > 0) {
    concerns.push(`${secretEvidence.length} secret scanner issues detected`);
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: secretEvidence.map((e) => e.id),
      assessment: 'No obvious hardcoded secrets detected in changes',
      confidence: 'MEDIUM',
      limit: 'Pattern-based detection; secret scanner may miss novel patterns',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: secretEvidence.map((e) => e.id),
    assessment: `Secret concerns: ${concerns.join('; ')}`,
    confidence: 'HIGH',
    limit:
      'Pattern-based detection; false positives possible for legitimate constants',
  };
}

export function analyzeAuthRegression(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, diff } = input;

  const authTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('auth') ||
        e.criterionId?.includes('login') ||
        e.criterionId?.includes('permission')),
  );
  const outcomeLimit = executionLimit(authTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for authentication regression analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect authentication changes',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for auth-related changes
  const authPatterns = [
    /auth/i,
    /login/i,
    /permission/i,
    /role/i,
    /access/i,
    /guard/i,
  ];

  const authChanges = lines.filter(
    (l) => l.startsWith('+') && authPatterns.some((p) => p.test(l)),
  );

  if (authChanges.length > 0 && authTestEvidence.length === 0) {
    concerns.push(
      'Authentication-related changes without corresponding test coverage',
    );
  }

  // Check for removed auth checks
  const removedAuthChecks = lines.filter(
    (l) => l.startsWith('-') && /if\s*\([^)]*\.\s*(can|has|is)[A-Z]/.test(l),
  );
  if (removedAuthChecks.length > 0) {
    concerns.push(
      `${removedAuthChecks.length} removed authorization checks detected`,
    );
  }

  if (authTestEvidence.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No authentication-specific test evidence available',
      confidence: 'LOW',
      limit: 'Requires auth-specific test coverage to verify no regression',
    };
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: authTestEvidence.map((e) => e.id),
      assessment:
        'No authentication regression detected; auth-specific tests exist',
      confidence: 'MEDIUM',
      limit: 'Pattern-based detection; complex auth flows require human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: authTestEvidence.map((e) => e.id),
    assessment: `Authentication regression concerns: ${concerns.join('; ')}`,
    confidence: 'HIGH',
    limit:
      'Pattern-based detection; some auth changes may be legitimate refactoring',
  };
}

export function analyzeAuthzRegression(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, diff } = input;

  const authzTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('authorize') ||
        e.criterionId?.includes('role') ||
        e.criterionId?.includes('access')),
  );
  const outcomeLimit = executionLimit(authzTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for authorization regression analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect authorization changes',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for authorization-related changes
  const authzPatterns = [
    /authorize/i,
    /can\s*\(/i,
    /has\s*[A-Z]/i,
    /is[A-Z]/i,
    /role/i,
    /permission/i,
  ];

  const authzChanges = lines.filter(
    (l) => l.startsWith('+') && authzPatterns.some((p) => p.test(l)),
  );

  if (authzChanges.length > 0 && authzTestEvidence.length === 0) {
    concerns.push(
      'Authorization-related changes without corresponding test coverage',
    );
  }

  // Check for removed authorization checks
  const removedAuthzChecks = lines.filter(
    (l) => l.startsWith('-') && /if\s*\([^)]*\.\s*(can|has|is)[A-Z]/.test(l),
  );
  if (removedAuthzChecks.length > 0) {
    concerns.push(
      `${removedAuthzChecks.length} removed authorization checks detected`,
    );
  }

  if (authzTestEvidence.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No authorization-specific test evidence available',
      confidence: 'LOW',
      limit:
        'Requires authorization-specific test coverage to verify no regression',
    };
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: authzTestEvidence.map((e) => e.id),
      assessment:
        'No authorization regression detected; authorization-specific tests exist',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; complex authorization flows require human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: authzTestEvidence.map((e) => e.id),
    assessment: `Authorization regression concerns: ${concerns.join('; ')}`,
    confidence: 'HIGH',
    limit:
      'Pattern-based detection; some authorization changes may be legitimate refactoring',
  };
}

export function analyzeInjection(input: BoundedAnalysisInput): AnalysisResult {
  const { evidence, diff } = input;

  const injectionTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('inject') ||
        e.criterionId?.includes('sanitize') ||
        e.criterionId?.includes('escape')),
  );
  const outcomeLimit = executionLimit(injectionTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for injection analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect input handling',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for dangerous patterns in added lines
  const dangerousPatterns = [
    /eval\s*\(/i,
    /innerHTML\s*=/i,
    /outerHTML\s*=/i,
    /document\.write/i,
    /exec\s*\(/i,
    /spawn\s*\(/i,
    /system\s*\(/i,
    /\$\{[^}]*\}/, // Template interpolation without escaping
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      dangerousPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Potentially dangerous pattern in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  if (injectionTestEvidence.length === 0) {
    concerns.push('No injection-specific test evidence available');
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: injectionTestEvidence.map((e) => e.id),
      assessment: 'No obvious injection vulnerabilities detected',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; sophisticated injection attacks may evade simple patterns',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: injectionTestEvidence.map((e) => e.id),
    assessment: `Injection concerns: ${concerns.join('; ')}`,
    confidence: 'HIGH',
    limit:
      'Pattern-based detection; context matters for many of these patterns',
  };
}

export function analyzeSensitiveData(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, diff } = input;

  const sensitiveTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('sensitive') ||
        e.criterionId?.includes('redact') ||
        e.criterionId?.includes('pii')),
  );
  const outcomeLimit = executionLimit(sensitiveTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for sensitive data analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect data handling',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for logging of potentially sensitive data
  const loggingPatterns = [
    /console\.log.*password/i,
    /console\.log.*token/i,
    /console\.log.*secret/i,
    /console\.log.*key/i,
    /log.*password/i,
    /log.*token/i,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      loggingPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Potential sensitive data logging in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  if (sensitiveTestEvidence.length === 0) {
    concerns.push('No sensitive data-specific test evidence available');
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: sensitiveTestEvidence.map((e) => e.id),
      assessment: 'No obvious sensitive data exposure detected',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual data sensitivity requires context',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: sensitiveTestEvidence.map((e) => e.id),
    assessment: `Sensitive data concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit: 'Pattern-based detection; legitimate logging may match patterns',
  };
}

export function analyzeCommandExecution(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, diff } = input;

  const commandTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('command') ||
        e.criterionId?.includes('exec') ||
        e.criterionId?.includes('shell')),
  );
  const outcomeLimit = executionLimit(commandTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for command execution analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect command execution',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for command execution patterns
  const commandPatterns = [
    /exec\s*\(/i,
    /spawn\s*\(/i,
    /execSync\s*\(/i,
    /child_process/i,
    /shell\s*:\s*true/i,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      commandPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Command execution in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  // Check for untrusted input in commands
  const untrustedInputPatterns = [
    /exec\s*\([^)]*\$\{/,
    /exec\s*\([^)]*req/,
    /exec\s*\([^)]*input/,
    /exec\s*\([^)]*user/,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      untrustedInputPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Potential untrusted input in command: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  if (commandTestEvidence.length === 0) {
    concerns.push('No command execution-specific test evidence available');
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: commandTestEvidence.map((e) => e.id),
      assessment: 'No unsafe command execution detected',
      confidence: 'MEDIUM',
      limit: 'Pattern-based detection; safe command execution requires context',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: commandTestEvidence.map((e) => e.id),
    assessment: `Command execution concerns: ${concerns.join('; ')}`,
    confidence: 'HIGH',
    limit:
      'Pattern-based detection; legitimate command execution may match patterns',
  };
}

export function analyzeFileHandling(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, diff } = input;

  const fileTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('file') ||
        e.criterionId?.includes('path') ||
        e.criterionId?.includes('traversal')),
  );
  const outcomeLimit = executionLimit(fileTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for file handling analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect file operations',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for path traversal patterns
  const traversalPatterns = [
    /\.\.\//,
    /\.\.\\/,
    /path\s*\.\s*concat/i,
    /path\s*\+\s*['"]\.\./i,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      traversalPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Potential path traversal in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  // Check for unsafe file operations
  const unsafePatterns = [
    /readFileSync\s*\([^)]*\$\{/,
    /writeFileSync\s*\([^)]*\$\{/,
    /unlinkSync\s*\([^)]*\$\{/,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      unsafePatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Unsafe file operation with potential untrusted input: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  if (fileTestEvidence.length === 0) {
    concerns.push('No file handling-specific test evidence available');
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: fileTestEvidence.map((e) => e.id),
      assessment: 'No unsafe file handling detected',
      confidence: 'MEDIUM',
      limit: 'Pattern-based detection; safe file operations require context',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: fileTestEvidence.map((e) => e.id),
    assessment: `File handling concerns: ${concerns.join('; ')}`,
    confidence: 'HIGH',
    limit:
      'Pattern-based detection; legitimate file operations may match patterns',
  };
}

export function analyzePermissionBypass(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { evidence, diff } = input;

  const permissionTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('permission') ||
        e.criterionId?.includes('bypass') ||
        e.criterionId?.includes('access')),
  );
  const outcomeLimit = executionLimit(permissionTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for permission bypass analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect permission checks',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for removed permission checks
  const removedChecks = lines.filter(
    (l) => l.startsWith('-') && /if\s*\([^)]*\.\s*(can|has|is)[A-Z]/.test(l),
  );
  if (removedChecks.length > 0) {
    concerns.push(`${removedChecks.length} removed permission checks detected`);
  }

  // Check for commented-out permission checks
  const commentedChecks = lines.filter(
    (l) =>
      l.startsWith('+') && /\/\/.*if\s*\([^)]*\.\s*(can|has|is)[A-Z]/.test(l),
  );
  if (commentedChecks.length > 0) {
    concerns.push(
      `${commentedChecks.length} commented-out permission checks detected`,
    );
  }

  if (permissionTestEvidence.length === 0) {
    concerns.push('No permission-specific test evidence available');
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: permissionTestEvidence.map((e) => e.id),
      assessment: 'No permission bypass detected',
      confidence: 'MEDIUM',
      limit: 'Pattern-based detection; permission logic may be complex',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: permissionTestEvidence.map((e) => e.id),
    assessment: `Permission bypass concerns: ${concerns.join('; ')}`,
    confidence: 'HIGH',
    limit:
      'Pattern-based detection; legitimate refactoring may remove unused checks',
  };
}

export function analyzeConsistency(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { imports, exports, changedFiles } = input;

  if (!changedFiles || changedFiles.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No changed files available for consistency analysis',
      confidence: 'LOW',
      limit: 'Requires changed file list to analyze consistency',
    };
  }

  if (
    !imports ||
    changedFiles.some((file) => !Object.hasOwn(imports, file)) ||
    !exports ||
    changedFiles.some((file) => !Object.hasOwn(exports, file))
  )
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'Scoped module inventory is missing for changed files',
      confidence: 'LOW',
      limit:
        'Requires actual import/export inventory; file presence is context only',
    };

  const concerns: string[] = [];

  // Check for inconsistent import styles
  if (imports) {
    const importStyles = new Map<string, number>();
    Object.values(imports)
      .flat()
      .forEach((imp) => {
        const style = imp.includes('from') ? 'named' : 'default';
        importStyles.set(style, (importStyles.get(style) || 0) + 1);
      });

    if (importStyles.size > 1) {
      concerns.push('Mixed import styles detected');
    }
  }

  // Check for inconsistent export patterns
  if (exports) {
    const exportStyles = new Map<string, number>();
    Object.values(exports)
      .flat()
      .forEach((exp) => {
        const style = exp.includes('export default') ? 'default' : 'named';
        exportStyles.set(style, (exportStyles.get(style) || 0) + 1);
      });

    if (exportStyles.size > 1) {
      concerns.push('Mixed export styles detected');
    }
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'Code style appears consistent',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; architectural consistency requires human review',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Consistency concerns: ${concerns.join('; ')}`,
    confidence: 'LOW',
    limit: 'Pattern-based detection; style inconsistencies may be intentional',
  };
}

export function analyzeBoundaries(input: BoundedAnalysisInput): AnalysisResult {
  const { imports, changedFiles } = input;

  if (!changedFiles || changedFiles.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No changed files available for boundary analysis',
      confidence: 'LOW',
      limit: 'Requires changed file list to analyze module boundaries',
    };
  }

  if (!imports || changedFiles.some((file) => !Object.hasOwn(imports, file)))
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'Scoped module inventory is missing for changed files',
      confidence: 'LOW',
      limit:
        'Requires actual import/export inventory; file presence is context only',
    };

  const concerns: string[] = [];

  // Check for cross-layer imports (more lenient - only flag very different layers)
  if (imports) {
    Object.entries(imports).forEach(([file, fileImports]) => {
      const fileLayer = file.split('/').slice(0, 2).join('/'); // Extract first two segments
      fileImports.forEach((imp) => {
        const importLayer = imp.split('/').slice(0, 2).join('/');
        // Only flag if importing from very different layers (e.g., ui importing from db)
        const sensitiveLayers = ['src/db', 'src/ui', 'src/api', 'src/auth'];
        if (
          sensitiveLayers.includes(fileLayer) &&
          sensitiveLayers.includes(importLayer) &&
          fileLayer !== importLayer
        ) {
          concerns.push(
            `Cross-layer import in ${file}: imports from ${importLayer}`,
          );
        }
      });
    });
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'Module boundaries appear respected',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual layer boundaries require architectural context',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Boundary concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit: 'Pattern-based detection; cross-layer imports may be intentional',
  };
}

export function analyzeCohesion(input: BoundedAnalysisInput): AnalysisResult {
  const { imports, exports, changedFiles } = input;

  if (!changedFiles || changedFiles.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No changed files available for cohesion analysis',
      confidence: 'LOW',
      limit: 'Requires changed file list to analyze module cohesion',
    };
  }

  if (
    !imports ||
    changedFiles.some((file) => !Object.hasOwn(imports, file)) ||
    !exports ||
    changedFiles.some((file) => !Object.hasOwn(exports, file))
  )
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'Scoped module inventory is missing for changed files',
      confidence: 'LOW',
      limit:
        'Requires actual import/export inventory; file presence is context only',
    };

  const concerns: string[] = [];

  // Check for files with unrelated exports
  if (exports) {
    Object.entries(exports).forEach(([file, fileExports]) => {
      const exportPrefixes = new Set(
        fileExports
          .map((e) => {
            const parts = e.split(/[A-Z]/);
            return parts[0]?.toLowerCase() || '';
          })
          .filter((p) => p.length > 0),
      );
      if (exportPrefixes.size > 3) {
        concerns.push(`${file} exports multiple unrelated symbol groups`);
      }
    });
  }

  // Check for files importing from many different domains
  if (imports) {
    Object.entries(imports).forEach(([file, fileImports]) => {
      const importDomains = new Set(fileImports.map((i) => i.split('/')[0]));
      if (importDomains.size > 4) {
        concerns.push(
          `${file} imports from ${importDomains.size} different domains, suggesting low cohesion`,
        );
      }
    });
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'Modules appear cohesive',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual cohesion requires semantic understanding',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Cohesion concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; low cohesion may be appropriate for utility modules',
  };
}

export function analyzeExtensibility(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { diff, evidence } = input;

  if (!diff) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff available for extensibility analysis',
      confidence: 'LOW',
      limit: 'Requires diff to inspect extensibility patterns',
    };
  }

  const lines = diff.split('\n');
  const concerns: string[] = [];

  // Check for hardcoded one-off behavior
  const hardcodedPatterns = [
    /if\s*\([^)]*\)===\s*['"][^'"]+['"]\s*{/, // if condition === "specific_value"
    /case\s+['"][^'"]+['"]\s*:/, // case "specific_value":
    /magic\s*number/i,
    /hardcoded/i,
  ];

  lines.forEach((line) => {
    if (line.startsWith('+')) {
      hardcodedPatterns.forEach((pattern) => {
        if (pattern.test(line)) {
          concerns.push(
            `Potential hardcoded behavior in added line: ${line.substring(0, 50)}...`,
          );
        }
      });
    }
  });

  // Check for lack of configuration/abstraction
  const configTestEvidence = evidence.filter(
    (e) =>
      e.kind === 'execution' &&
      (e.criterionId?.includes('config') ||
        e.criterionId?.includes('extend') ||
        e.criterionId?.includes('plugin')),
  );
  const outcomeLimit = executionLimit(configTestEvidence);
  if (outcomeLimit) return outcomeLimit;

  if (concerns.length > 0 && configTestEvidence.length === 0) {
    concerns.push('Hardcoded behavior without configuration/abstraction tests');
  }

  if (concerns.length === 0 && configTestEvidence.length === 0)
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment:
        'No scoped configuration or extension execution evidence available',
      confidence: 'LOW',
      limit: 'Absence of hardcoded patterns cannot establish extensibility',
    };

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: configTestEvidence.map((e) => e.id),
      assessment:
        'Code appears extensible; no obvious hardcoded one-off behavior',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; extensibility requires architectural context',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: configTestEvidence.map((e) => e.id),
    assessment: `Extensibility concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; some hardcoding may be intentional for specific cases',
  };
}

export function analyzeUnnecessaryRewrite(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { contract, diff, changedFiles } = input;

  if (!diff || !changedFiles) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'No diff or changed files available for rewrite analysis',
      confidence: 'LOW',
      limit: 'Requires diff and changed files to assess rewrite scope',
    };
  }

  const concerns: string[] = [];

  // Check if change scope matches requirement
  const requirementScope = contract.requirements.length;
  const changedFileCount = changedFiles.length;

  if (changedFileCount > requirementScope * 3) {
    concerns.push(
      `Large change scope (${changedFileCount} files) relative to requirements (${requirementScope})`,
    );
  }

  // Check for wholesale file replacement vs targeted changes
  const lineChanges = diff
    .split('\n')
    .filter((l) => l.startsWith('+') || l.startsWith('-')).length;
  if (lineChanges > 500) {
    concerns.push(
      `Very large diff (${lineChanges} lines), may indicate wholesale rewrite`,
    );
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'Change scope appears appropriate for requirements',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual rewrite necessity requires human judgment',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Potential unnecessary rewrite: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; large changes may be legitimate for complex requirements',
  };
}

export function analyzeResponsibilityPlacement(
  input: BoundedAnalysisInput,
): AnalysisResult {
  const { imports, exports, changedFiles } = input;

  if (!changedFiles || changedFiles.length === 0) {
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment:
        'No changed files available for responsibility placement analysis',
      confidence: 'LOW',
      limit: 'Requires changed file list to analyze responsibility placement',
    };
  }

  if (
    !imports ||
    changedFiles.some((file) => !Object.hasOwn(imports, file)) ||
    !exports ||
    changedFiles.some((file) => !Object.hasOwn(exports, file))
  )
    return {
      status: 'UNVERIFIED',
      evidenceIds: [],
      assessment: 'Scoped module inventory is missing for changed files',
      confidence: 'LOW',
      limit:
        'Requires actual import/export inventory; file presence is context only',
    };

  const concerns: string[] = [];

  // Check for misplaced responsibilities
  if (imports && exports) {
    Object.entries(imports).forEach(([file, fileImports]) => {
      const fileExports = exports[file] || [];

      // If a file imports database logic but exports UI code
      const hasDbImports = fileImports.some(
        (i) =>
          i.includes('db') || i.includes('database') || i.includes('query'),
      );
      const hasUiExports = fileExports.some(
        (e) =>
          e.includes('render') || e.includes('view') || e.includes('component'),
      );

      if (hasDbImports && hasUiExports) {
        concerns.push(`${file} mixes database imports with UI exports`);
      }

      // If a file imports from many unrelated domains
      const importDomains = new Set(fileImports.map((i) => i.split('/')[0]));
      if (importDomains.size > 5) {
        concerns.push(
          `${file} imports from many domains, suggesting misplaced responsibilities`,
        );
      }
    });
  }

  if (concerns.length === 0) {
    return {
      status: 'SUPPORTED',
      evidenceIds: [],
      assessment: 'Responsibilities appear appropriately placed',
      confidence: 'MEDIUM',
      limit:
        'Pattern-based detection; actual responsibility placement requires architectural context',
    };
  }

  return {
    status: 'CONCERN',
    evidenceIds: [],
    assessment: `Responsibility placement concerns: ${concerns.join('; ')}`,
    confidence: 'MEDIUM',
    limit:
      'Pattern-based detection; some mixing may be intentional for specific modules',
  };
}
