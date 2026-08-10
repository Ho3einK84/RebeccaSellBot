import type { RebeccaService } from './RebeccaService.js';
import type { RebeccaPanelRegistry, RebeccaTarget } from './RebeccaPanelRegistry.js';

export type RebeccaPanelAccess =
  | RebeccaService
  | Pick<RebeccaPanelRegistry, 'getService' | 'getEnabledPanelIds' | 'resolveTarget'>;

export type NormalizedRebeccaPanelAccess = Pick<
  RebeccaPanelRegistry,
  'getService' | 'getEnabledPanelIds' | 'resolveTarget'
>;

/** Compatibility boundary for jobs/tests while production always uses the registry. */
export function normalizeRebeccaPanelAccess(
  access: RebeccaPanelAccess
): NormalizedRebeccaPanelAccess {
  if (isPanelRegistry(access)) return access;
  return {
    getService: () => access,
    getEnabledPanelIds: () => ['legacy'],
    resolveTarget: async (panelId?: string, serviceId?: number): Promise<RebeccaTarget> => ({
      panelId: panelId ?? 'legacy',
      panelName: 'Legacy panel',
      serviceId: serviceId ?? 1,
      serviceName: 'Default service',
      service: access,
    }),
  };
}

export function getRebeccaService(
  access: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService,
  panelId?: string
): RebeccaService {
  return isServiceRegistry(access) ? access.getService(panelId ?? 'legacy') : access;
}

export function isRebeccaPanelRegistryAccess(
  access: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService
): access is Pick<RebeccaPanelRegistry, 'getService'> {
  return isServiceRegistry(access);
}

function isPanelRegistry(access: RebeccaPanelAccess): access is NormalizedRebeccaPanelAccess {
  return (
    typeof (access as Partial<NormalizedRebeccaPanelAccess>).getService === 'function' &&
    typeof (access as Partial<NormalizedRebeccaPanelAccess>).resolveTarget === 'function' &&
    typeof (access as Partial<NormalizedRebeccaPanelAccess>).getEnabledPanelIds === 'function'
  );
}

function isServiceRegistry(
  access: Pick<RebeccaPanelRegistry, 'getService'> | RebeccaService
): access is Pick<RebeccaPanelRegistry, 'getService'> {
  return (
    typeof (access as Partial<Pick<RebeccaPanelRegistry, 'getService'>>).getService === 'function'
  );
}
