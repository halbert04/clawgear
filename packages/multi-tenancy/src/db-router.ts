/**
 * Database-per-tenant connection routing.
 * Routes tenant queries to dedicated databases for whale customers
 * while falling back to the shared database for standard tenants.
 */

import type { TenantConfig, TenantDbConfig } from './types.js';

/** A database connection abstraction for routing */
export interface DbConnection {
  /** Connection identifier */
  id: string;
  /** Whether this is the shared/default connection */
  isShared: boolean;
  /** The connection string (for establishing connections) */
  connectionString: string;
  /** Whether this connection is read-only */
  readOnly: boolean;
  /** Pool size */
  poolSize: number;
}

/**
 * TenantDbRouter — routes database operations to the correct connection
 * based on tenant configuration. Whale tenants get dedicated databases,
 * standard tenants share the default database.
 */
export class TenantDbRouter {
  private readonly sharedDb: DbConnection;
  private readonly tenantDbs = new Map<string, DbConnection>();
  private readonly tenantConfigs = new Map<string, TenantConfig>();

  constructor(sharedConnectionString: string, sharedPoolSize = 20) {
    this.sharedDb = {
      id: 'shared',
      isShared: true,
      connectionString: sharedConnectionString,
      readOnly: false,
      poolSize: sharedPoolSize,
    };
  }

  /** Register a tenant with optional dedicated database */
  registerTenant(config: TenantConfig): void {
    this.tenantConfigs.set(config.tenantId, config);

    if (config.dedicatedDb) {
      this.tenantDbs.set(config.tenantId, {
        id: `tenant_${config.tenantId}`,
        isShared: false,
        connectionString: config.dedicatedDb.connectionString,
        readOnly: config.dedicatedDb.readOnly,
        poolSize: config.dedicatedDb.poolSize,
      });
    }
  }

  /** Remove a tenant's dedicated database connection */
  removeTenant(tenantId: string): void {
    this.tenantConfigs.delete(tenantId);
    this.tenantDbs.delete(tenantId);
  }

  /**
   * Resolve the database connection for a tenant.
   * Returns the dedicated connection if configured, otherwise the shared database.
   */
  resolve(tenantId: string): DbConnection {
    return this.tenantDbs.get(tenantId) ?? this.sharedDb;
  }

  /** Check if a tenant has a dedicated database */
  hasDedicatedDb(tenantId: string): boolean {
    return this.tenantDbs.has(tenantId);
  }

  /** Get the shared database connection */
  getSharedDb(): DbConnection {
    return this.sharedDb;
  }

  /** Get all registered tenant IDs */
  getTenantIds(): string[] {
    return [...this.tenantConfigs.keys()];
  }

  /** Get count of dedicated database connections */
  getDedicatedDbCount(): number {
    return this.tenantDbs.size;
  }

  /** Get a tenant's configuration */
  getTenantConfig(tenantId: string): TenantConfig | undefined {
    return this.tenantConfigs.get(tenantId);
  }

  /**
   * Migrate a tenant from shared to dedicated database.
   * Returns the new connection config.
   */
  migrateToDedicated(tenantId: string, dbConfig: TenantDbConfig): DbConnection {
    const existing = this.tenantConfigs.get(tenantId);
    if (existing) {
      existing.dedicatedDb = dbConfig;
    }

    const connection: DbConnection = {
      id: `tenant_${tenantId}`,
      isShared: false,
      connectionString: dbConfig.connectionString,
      readOnly: dbConfig.readOnly,
      poolSize: dbConfig.poolSize,
    };

    this.tenantDbs.set(tenantId, connection);
    return connection;
  }

  /**
   * Migrate a tenant from dedicated back to shared database.
   */
  migrateToShared(tenantId: string): void {
    this.tenantDbs.delete(tenantId);
    const existing = this.tenantConfigs.get(tenantId);
    if (existing) {
      existing.dedicatedDb = null;
    }
  }
}
