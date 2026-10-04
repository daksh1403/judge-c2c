import { describe, it, expect } from 'vitest';
import {
  analyzeSymptomMasking,
  analyzeDuplication,
  analyzeNoPrivateIntentions,
  analyzeSeparationOfConcerns,
  analyzeErrorHandling,
  analyzeNaming,
  analyzeAPIDesign,
  analyzeTechnicalDebt,
  analyzeTestability,
  analyzeHardcodedSecrets,
  analyzeAuthRegression,
  analyzeAuthzRegression,
  analyzeInjection,
  analyzeSensitiveData,
  analyzeCommandExecution,
  analyzeFileHandling,
  analyzePermissionBypass,
  analyzeConsistency,
  analyzeBoundaries,
  analyzeCohesion,
  analyzeExtensibility,
  analyzeUnnecessaryRewrite,
  analyzeResponsibilityPlacement,
} from '../src/bounded-analysis';
import { demoContract } from '../src/demo';

describe('Bounded evidence-backed analysis', () => {
  describe('analyzeSymptomMasking', () => {
    it('returns SUPPORTED when no symptom masking patterns and tests exist', () => {
      const result = analyzeSymptomMasking({
        contract: demoContract,
        evidence: [
          {
            id: 'test-1',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'retry-bounded',
            claim: 'Test passed',
          },
        ],
        diff: '+function fix() {\n+  return correctValue;\n+}',
      });
      expect(result.status).toBe('SUPPORTED');
      expect(result.confidence).toBe('MEDIUM');
      expect(result.assessment).toContain('No obvious symptom masking');
    });

    it('returns CONCERN when narrow guard conditions detected', () => {
      const result = analyzeSymptomMasking({
        contract: demoContract,
        evidence: [
          {
            id: 'test-1',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'retry-bounded',
            claim: 'Test passed',
          },
        ],
        diff: '+if (guard) return null;\n+function fix() {}',
      });
      expect(result.status).toBe('CONCERN');
      expect(result.assessment).toContain('Narrow guard conditions');
    });

    it('returns UNVERIFIED when no test evidence', () => {
      const result = analyzeSymptomMasking({
        contract: demoContract,
        evidence: [],
        diff: '+function fix() {}',
      });
      expect(result.status).toBe('UNVERIFIED');
      expect(result.assessment).toContain('Insufficient test evidence');
    });
  });

  describe('analyzeDuplication', () => {
    it('returns SUPPORTED when no duplication detected', () => {
      const result = analyzeDuplication({
        contract: demoContract,
        evidence: [],
        diff: '+function a() {}\n+function b() {}',
        changedFiles: ['src/file.ts'],
      });
      expect(result.status).toBe('SUPPORTED');
      expect(result.assessment).toContain('No obvious duplication');
    });

    it('returns CONCERN when repeated code blocks detected', () => {
      const result = analyzeDuplication({
        contract: demoContract,
        evidence: [],
        diff: '+const x = calculate();\n+const x = calculate();\n+const x = calculate();\n+const x = calculate();',
        changedFiles: ['src/file.ts'],
      });
      expect(result.status).toBe('CONCERN');
      expect(result.assessment).toContain('repeated code blocks');
    });

    it('returns UNVERIFIED when no diff available', () => {
      const result = analyzeDuplication({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/file.ts'],
      });
      expect(result.status).toBe('UNVERIFIED');
    });
  });

  describe('analyzeNoPrivateIntentions', () => {
    it('returns SUPPORTED when no intention claims detected', () => {
      const result = analyzeNoPrivateIntentions({
        contract: demoContract,
        evidence: [],
        diff: '+function process(data) {\n+  return data.value;\n+}',
      });
      expect(result.status).toBe('SUPPORTED');
      expect(result.confidence).toBe('HIGH');
    });

    it('returns CONCERN when intention claims detected', () => {
      const result = analyzeNoPrivateIntentions({
        contract: demoContract,
        evidence: [],
        diff: '+// Intentionally returns null\n+function process() {\n+  return null;\n+}',
      });
      expect(result.status).toBe('CONCERN');
      expect(result.assessment).toContain('intention');
    });
  });

  describe('analyzeSeparationOfConcerns', () => {
    it('returns SUPPORTED when separation is maintained', () => {
      const result = analyzeSeparationOfConcerns({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/auth/login.ts'],
        imports: {
          'src/auth/login.ts': ['../types', '../utils'],
        },
        exports: {
          'src/auth/login.ts': ['function login', 'function logout'],
        },
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when mixed concerns detected', () => {
      const result = analyzeSeparationOfConcerns({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/utils/mixed.ts'],
        imports: {
          'src/utils/mixed.ts': [
            '../auth',
            '../db',
            '../ui',
            '../api',
            '../config',
            '../logger',
            '../utils',
          ],
        },
        exports: {
          'src/utils/mixed.ts': [
            'class AuthHandler',
            'function queryDb',
            'function renderView',
            'const config',
            'type Config',
          ],
        },
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeErrorHandling', () => {
    it('returns SUPPORTED when error handling is appropriate', () => {
      const result = analyzeErrorHandling({
        contract: demoContract,
        evidence: [
          {
            id: 'error-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'error-handling',
            claim: 'Error test passed',
          },
        ],
        diff: '+try {\n+  risky();\n+} catch (e) {\n+  log(e);\n+  throw e;\n+}',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when silent error catches detected', () => {
      const result = analyzeErrorHandling({
        contract: demoContract,
        evidence: [
          {
            id: 'error-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'error-handling',
            claim: 'Error test passed',
          },
        ],
        diff: '+try {\n+  risky();\n+} catch (e) {}',
      });
      expect(result.status).toBe('CONCERN');
      expect(result.assessment).toContain('silent error');
    });
  });

  describe('analyzeNaming', () => {
    it('returns SUPPORTED when naming follows conventions', () => {
      const result = analyzeNaming({
        contract: demoContract,
        evidence: [],
        changedSymbols: ['processData', 'calculateResult', 'validateInput'],
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when naming issues detected', () => {
      const result = analyzeNaming({
        contract: demoContract,
        evidence: [],
        changedSymbols: ['ab', 'bad_name_WithMixed', 'x'],
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeAPIDesign', () => {
    it('returns SUPPORTED when API design is reasonable', () => {
      const result = analyzeAPIDesign({
        contract: demoContract,
        evidence: [
          {
            id: 'api-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'api-compatibility',
            claim: 'API test passed',
          },
        ],
        exports: {
          'src/api/user.ts': [
            'function getUser(id: string): User',
            'function createUser(data: User): User',
          ],
        },
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when high parameter count detected', () => {
      const result = analyzeAPIDesign({
        contract: demoContract,
        evidence: [
          {
            id: 'api-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'api-compatibility',
            claim: 'API test passed',
          },
        ],
        exports: {
          'src/api/complex.ts': [
            'function complexFunction(a, b, c, d, e, f, g, h, i, j): Result',
          ],
        },
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeTechnicalDebt', () => {
    it('returns SUPPORTED when no debt markers', () => {
      const result = analyzeTechnicalDebt({
        contract: demoContract,
        evidence: [],
        diff: '+function clean() {\n+  return value;\n+}',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when TODO/FIXME detected', () => {
      const result = analyzeTechnicalDebt({
        contract: demoContract,
        evidence: [],
        diff: '+// TODO: fix this later\n+function temp() {}',
      });
      expect(result.status).toBe('CONCERN');
      expect(result.assessment).toContain('Technical debt');
    });
  });

  describe('analyzeTestability', () => {
    it('returns SUPPORTED when tests exist', () => {
      const result = analyzeTestability({
        contract: demoContract,
        evidence: [
          {
            id: 'test-1',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'test-functional',
            claim: 'Test passed',
          },
        ],
        changedFiles: ['src/feature.ts', 'src/feature.test.ts'],
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when code changes without tests', () => {
      const result = analyzeTestability({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/feature.ts'],
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeHardcodedSecrets', () => {
    it('returns SUPPORTED when no secrets detected', () => {
      const result = analyzeHardcodedSecrets({
        contract: demoContract,
        evidence: [],
        diff: '+const config = { apiUrl: process.env.API_URL };',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when potential secrets detected', () => {
      const result = analyzeHardcodedSecrets({
        contract: demoContract,
        evidence: [],
        diff: '+const password = "secret123";',
      });
      expect(result.status).toBe('CONCERN');
      expect(result.confidence).toBe('HIGH');
    });
  });

  describe('analyzeAuthRegression', () => {
    it('returns SUPPORTED when no auth regression', () => {
      const result = analyzeAuthRegression({
        contract: demoContract,
        evidence: [
          {
            id: 'auth-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'auth-check',
            claim: 'Auth test passed',
          },
        ],
        diff: '+function verify() {\n+  return true;\n+}',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when auth checks removed', () => {
      const result = analyzeAuthRegression({
        contract: demoContract,
        evidence: [
          {
            id: 'auth-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'auth-check',
            claim: 'Auth test passed',
          },
        ],
        diff: '-if (user.canAccess()) {\n+// Removed check\n',
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeAuthzRegression', () => {
    it('returns SUPPORTED when no authz regression', () => {
      const result = analyzeAuthzRegression({
        contract: demoContract,
        evidence: [
          {
            id: 'authz-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'access',
            claim: 'Authz test passed',
          },
        ],
        diff: '+function check() {\n+  // Added permission check\n+  if (result.canAccess()) action();\n+}',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns UNVERIFIED when no test evidence', () => {
      const result = analyzeAuthzRegression({
        contract: demoContract,
        evidence: [],
        diff: '+function check() {}',
      });
      expect(result.status).toBe('UNVERIFIED');
    });
  });

  describe('analyzeInjection', () => {
    it('returns SUPPORTED when no injection vulnerabilities', () => {
      const result = analyzeInjection({
        contract: demoContract,
        evidence: [
          {
            id: 'inject-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'injection-test',
            claim: 'Injection test passed',
          },
        ],
        diff: '+const sanitized = input.replace(/</g, "&lt;");',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when dangerous patterns detected', () => {
      const result = analyzeInjection({
        contract: demoContract,
        evidence: [],
        diff: '+element.innerHTML = userInput;',
      });
      expect(result.status).toBe('CONCERN');
      expect(result.confidence).toBe('HIGH');
    });
  });

  describe('analyzeSensitiveData', () => {
    it('returns SUPPORTED when no sensitive data exposure', () => {
      const result = analyzeSensitiveData({
        contract: demoContract,
        evidence: [
          {
            id: 'sensitive-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'sensitive-data',
            claim: 'Sensitive data test passed',
          },
        ],
        diff: '+console.log("Processing data");',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when logging sensitive data', () => {
      const result = analyzeSensitiveData({
        contract: demoContract,
        evidence: [],
        diff: '+console.log("Password:", password);',
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeCommandExecution', () => {
    it('returns SUPPORTED when no unsafe commands', () => {
      const result = analyzeCommandExecution({
        contract: demoContract,
        evidence: [
          {
            id: 'command-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'command-execution',
            claim: 'Command test passed',
          },
        ],
        diff: '+const result = safeFunction();',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when untrusted input in command', () => {
      const result = analyzeCommandExecution({
        contract: demoContract,
        evidence: [],
        diff: '+exec(userInput);',
      });
      expect(result.status).toBe('CONCERN');
      expect(result.confidence).toBe('HIGH');
    });
  });

  describe('analyzeFileHandling', () => {
    it('returns SUPPORTED when safe file operations', () => {
      const result = analyzeFileHandling({
        contract: demoContract,
        evidence: [
          {
            id: 'file-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'file-handling',
            claim: 'File test passed',
          },
        ],
        diff: '+fs.readFileSync(safePath);',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when path traversal detected', () => {
      const result = analyzeFileHandling({
        contract: demoContract,
        evidence: [],
        diff: '+fs.readFileSync("../" + userPath);',
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzePermissionBypass', () => {
    it('returns SUPPORTED when no bypass', () => {
      const result = analyzePermissionBypass({
        contract: demoContract,
        evidence: [
          {
            id: 'permission-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'permission',
            claim: 'Permission test passed',
          },
        ],
        diff: '+if (user.can()) { action(); }',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when permission checks removed', () => {
      const result = analyzePermissionBypass({
        contract: demoContract,
        evidence: [],
        diff: '-if (user.can()) {\n+action();\n',
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeConsistency', () => {
    it('returns SUPPORTED when style is consistent', () => {
      const result = analyzeConsistency({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/file.ts'],
        imports: {
          'src/file.ts': ['../types', '../utils'],
        },
        exports: {
          'src/file.ts': ['export function a', 'export function b'],
        },
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when mixed styles', () => {
      const result = analyzeConsistency({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/file.ts'],
        imports: {
          'src/file.ts': ['require("a")', 'import { b } from "c"'],
        },
        exports: {
          'src/file.ts': ['export default d', 'export { e }'],
        },
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeBoundaries', () => {
    it('returns SUPPORTED when boundaries respected', () => {
      const result = analyzeBoundaries({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/auth/login.ts'],
        imports: {
          'src/auth/login.ts': ['../types', '../utils/auth'],
        },
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when cross-layer imports', () => {
      const result = analyzeBoundaries({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/ui/component.ts'],
        imports: {
          'src/ui/component.ts': ['src/db/query', 'src/api/client'],
        },
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeCohesion', () => {
    it('returns SUPPORTED when modules are cohesive', () => {
      const result = analyzeCohesion({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/auth/login.ts'],
        imports: {
          'src/auth/login.ts': ['../types', '../utils/auth'],
        },
        exports: {
          'src/auth/login.ts': ['login', 'logout', 'register'],
        },
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when low cohesion', () => {
      const result = analyzeCohesion({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/utils/mixed.ts'],
        imports: {
          'src/utils/mixed.ts': [
            '../db',
            '../ui',
            '../api',
            '../auth',
            '../config',
          ],
        },
        exports: {
          'src/utils/mixed.ts': [
            'dbquery',
            'render',
            'apicall',
            'authcheck',
            'configval',
          ],
        },
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeExtensibility', () => {
    it('returns SUPPORTED when code is extensible', () => {
      const result = analyzeExtensibility({
        contract: demoContract,
        evidence: [
          {
            id: 'config-test',
            kind: 'execution',
            status: 'PASS',
            criterionId: 'config',
            claim: 'Config test passed',
          },
        ],
        diff: '+const config = getConfig();\n+function process(config) {}',
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when hardcoded behavior', () => {
      const result = analyzeExtensibility({
        contract: demoContract,
        evidence: [],
        diff: '+if (value === "specific_hardcoded_value") {',
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeUnnecessaryRewrite', () => {
    it('returns SUPPORTED when change scope is appropriate', () => {
      const result = analyzeUnnecessaryRewrite({
        contract: demoContract,
        evidence: [],
        diff: '+function fix() {\n+  return value;\n+}',
        changedFiles: ['src/fix.ts'],
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when large rewrite', () => {
      const result = analyzeUnnecessaryRewrite({
        contract: demoContract,
        evidence: [],
        diff: Array(600).fill('+line').join('\n'),
        changedFiles: Array(10)
          .fill(null)
          .map((_, i) => `src/file${i}.ts`),
      });
      expect(result.status).toBe('CONCERN');
    });
  });

  describe('analyzeResponsibilityPlacement', () => {
    it('returns SUPPORTED when responsibilities are placed correctly', () => {
      const result = analyzeResponsibilityPlacement({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/db/repository.ts'],
        imports: {
          'src/db/repository.ts': ['../types', '../utils/db'],
        },
        exports: {
          'src/db/repository.ts': ['query', 'save', 'delete'],
        },
      });
      expect(result.status).toBe('SUPPORTED');
    });

    it('returns CONCERN when misplaced responsibilities', () => {
      const result = analyzeResponsibilityPlacement({
        contract: demoContract,
        evidence: [],
        changedFiles: ['src/ui/component.ts'],
        imports: {
          'src/ui/component.ts': ['../db/query', '../auth/login'],
        },
        exports: {
          'src/ui/component.ts': ['render', 'saveToDb', 'checkAuth'],
        },
      });
      expect(result.status).toBe('CONCERN');
    });
  });
});

describe('execution and inspection grounding regressions', () => {
  const behavioralAnalyzers = [
    analyzeSymptomMasking,
    analyzeErrorHandling,
    analyzeAPIDesign,
    analyzeTestability,
    analyzeAuthRegression,
    analyzeAuthzRegression,
    analyzeInjection,
    analyzeSensitiveData,
    analyzeCommandExecution,
    analyzeFileHandling,
    analyzePermissionBypass,
    analyzeExtensibility,
  ];
  it.each(behavioralAnalyzers)(
    '%s does not support failed or unverified scoped execution',
    (analyzer) => {
      for (const status of ['FAIL', 'UNVERIFIED'] as const) {
        const result = analyzer({
          contract: demoContract,
          evidence: [
            {
              id: 'scoped-test',
              kind: 'execution',
              status,
              criterionId:
                'test-error-api-auth-authorize-injection-sensitive-command-file-permission-config',
              claim: 'Configured outcome',
            },
          ],
          diff: '+function execute() { return true; }',
          changedFiles: ['src/main.ts', 'src/main.test.ts'],
          exports: { 'src/main.ts': ['function execute'] },
        });
        expect(result.status).toBe(
          status === 'FAIL' ? 'CONCERN' : 'UNVERIFIED',
        );
        expect(result.evidenceIds).toEqual(['scoped-test']);
        expect(result.assessment).not.toContain(
          'implementation addresses test cases',
        );
      }
    },
  );
  it.each([
    analyzeSeparationOfConcerns,
    analyzeConsistency,
    analyzeBoundaries,
    analyzeCohesion,
    analyzeResponsibilityPlacement,
  ])(
    '%s keeps absent and incomplete module inventories unverified',
    (analyzer) => {
      const inventories: (Record<string, string[]> | undefined)[] = [
        undefined,
        {},
        { 'src/other.ts': [] },
      ];
      for (const inventory of inventories) {
        const result = analyzer({
          contract: demoContract,
          evidence: [],
          changedFiles: ['src/main.ts'],
          imports: inventory,
          exports: inventory,
        });
        expect(result.status).toBe('UNVERIFIED');
      }
    },
  );
  it('does not infer symptom masking or API design from passing execution alone', () => {
    const evidence = [
      {
        id: 'pass',
        kind: 'execution' as const,
        status: 'PASS' as const,
        criterionId: 'api-test',
        claim: 'Scoped check passed',
      },
    ];
    expect(
      analyzeSymptomMasking({ contract: demoContract, evidence }).status,
    ).toBe('UNVERIFIED');
    expect(
      analyzeAPIDesign({ contract: demoContract, evidence, exports: {} })
        .status,
    ).toBe('UNVERIFIED');
    expect(
      analyzeExtensibility({
        contract: demoContract,
        evidence: [],
        diff: '+const configuration = {};',
      }).status,
    ).toBe('UNVERIFIED');
  });
});
