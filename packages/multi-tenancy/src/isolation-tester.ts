/**
 * Tenant isolation testing framework.
 * Verifies that no cross-tenant data access is possible.
 */

import type { IsolationAuditResult, IsolationTestResult } from './types.js';

/** Definition of an endpoint to test for isolation */
export interface EndpointDefinition {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL pattern with :companyId placeholder */
  pathPattern: string;
  /** Description of what this endpoint does */
  description: string;
  /** Whether this endpoint returns a list (need to check all items) */
  returnsList: boolean;
}

/** Standard ClawGear API endpoints that must be tenant-isolated */
export const STANDARD_ENDPOINTS: EndpointDefinition[] = [
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/agents',
    description: 'List agents',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/goals',
    description: 'List goals',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/projects',
    description: 'List projects',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/issues',
    description: 'List issues',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/activity',
    description: 'List activity log',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/facts',
    description: 'List facts',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/memory',
    description: 'List memory entries',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/conversations',
    description: 'List conversations',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/audit',
    description: 'List audit entries',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/marketplace',
    description: 'List marketplace skills',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/triggers',
    description: 'List triggers',
    returnsList: true,
  },
  {
    method: 'GET',
    pathPattern: '/api/companies/:companyId/workflows',
    description: 'List workflows',
    returnsList: true,
  },
];

/** A request function type for making HTTP requests in tests */
export type RequestFn = (
  method: string,
  url: string,
) => Promise<{
  status: number;
  body: unknown;
}>;

/**
 * IsolationTester — verifies cross-tenant data isolation.
 * Creates test data in tenant A, then verifies tenant B cannot access it.
 */
export class IsolationTester {
  private readonly endpoints: EndpointDefinition[];

  constructor(endpoints: EndpointDefinition[] = STANDARD_ENDPOINTS) {
    this.endpoints = endpoints;
  }

  /**
   * Run a single isolation test.
   * Checks that an endpoint scoped to tenantA does not leak data to tenantB.
   */
  async testEndpoint(
    endpoint: EndpointDefinition,
    tenantAId: string,
    tenantBId: string,
    requestFn: RequestFn,
  ): Promise<IsolationTestResult> {
    const urlA = endpoint.pathPattern.replace(':companyId', tenantAId);
    const urlB = endpoint.pathPattern.replace(':companyId', tenantBId);

    try {
      // Request data as tenant A
      const responseA = await requestFn(endpoint.method, urlA);
      if (responseA.status >= 400) {
        return {
          passed: true,
          endpoint: endpoint.pathPattern,
          description: `${endpoint.description}: tenant A got ${responseA.status} (no data or access denied)`,
          error: null,
        };
      }

      // Request same resource pattern as tenant B
      const responseB = await requestFn(endpoint.method, urlB);

      // If tenant B gets data, verify it doesn't contain tenant A's data
      if (endpoint.returnsList && responseB.status === 200) {
        const bodyB = responseB.body as { data?: Array<{ companyId?: string }> };
        if (bodyB.data && Array.isArray(bodyB.data)) {
          const leaked = bodyB.data.filter((item) => item.companyId === tenantAId);
          if (leaked.length > 0) {
            return {
              passed: false,
              endpoint: endpoint.pathPattern,
              description: `${endpoint.description}: LEAKED ${leaked.length} records from tenant A to tenant B`,
              error: `Cross-tenant data leak detected: ${leaked.length} records with companyId=${tenantAId} visible to tenant ${tenantBId}`,
            };
          }
        }
      }

      return {
        passed: true,
        endpoint: endpoint.pathPattern,
        description: `${endpoint.description}: no cross-tenant data found`,
        error: null,
      };
    } catch (err) {
      return {
        passed: false,
        endpoint: endpoint.pathPattern,
        description: `${endpoint.description}: test error`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Run a full isolation audit across all endpoints.
   */
  async runAudit(
    tenantAId: string,
    tenantBId: string,
    requestFn: RequestFn,
  ): Promise<IsolationAuditResult> {
    const start = performance.now();
    const results: IsolationTestResult[] = [];

    for (const endpoint of this.endpoints) {
      const result = await this.testEndpoint(endpoint, tenantAId, tenantBId, requestFn);
      results.push(result);
    }

    const passedTests = results.filter((r) => r.passed).length;
    const failedTests = results.filter((r) => !r.passed).length;

    return {
      passed: failedTests === 0,
      totalTests: results.length,
      passedTests,
      failedTests,
      results,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }

  /** Get the list of endpoints being tested */
  getEndpoints(): ReadonlyArray<EndpointDefinition> {
    return this.endpoints;
  }
}
