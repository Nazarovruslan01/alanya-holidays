import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  itinerariesService,
  type SavedItinerary,
} from '@/api-services/itineraries.service';
import { useAuth } from '@/context/AuthContext';
import type { RequestOptions } from '@/lib/api-client';
import { logger } from "@/lib/logger";

export interface PlanItem {
  id: string;
  type: 'business' | 'event' | 'custom';
  referenceId?: string;
  customName?: string;
  customDescription?: string;
  image?: string;
  subcategory?: string;
  dayLabel: string;
  timeSlot: string;
  notes: string;
  completed: boolean;
  order: number;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  items: PlanItem[];
  params?: Record<string, unknown>;
  localRevision?: number;
  isCloudSaved?: boolean;
}

const STORAGE_KEY = 'alanya-planner-plans';

interface PlannerState {
  storageKey: string;
  plans: Plan[];
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getStorageKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

function getAuthOptions(accessToken: string): RequestOptions {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

function loadPlans(storageKey: string): Plan[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Plan[];
    }
  } catch {
    // corrupted data
  }
  return [];
}

function savePlans(storageKey: string, plans: Plan[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, JSON.stringify(plans));
  } catch {
    // storage full
  }
}

function mapSavedItineraryToPlan(itinerary: SavedItinerary): Plan {
  const description =
    itinerary.params && typeof itinerary.params === 'object' && 'description' in itinerary.params
      ? String(itinerary.params.description)
      : '';

  return {
    id: itinerary.id,
    name: itinerary.title,
    description,
    createdAt: itinerary.created_at || new Date().toISOString(),
    updatedAt: itinerary.updated_at || itinerary.created_at || new Date().toISOString(),
    items: Array.isArray(itinerary.itinerary) ? (itinerary.itinerary as PlanItem[]) : [],
    params:
      itinerary.params && typeof itinerary.params === 'object'
        ? { ...itinerary.params }
        : {},
    localRevision: 0,
    isCloudSaved: true,
  };
}

export function usePlanner() {
  const { user, session } = useAuth();
  const userId = user?.id ?? null;
  const accessToken = session?.access_token ?? null;
  const storageKey = getStorageKey(userId);
  const [plannerState, setPlannerState] = useState<PlannerState>(() => ({
    storageKey,
    plans: loadPlans(storageKey),
  }));
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const activeStorageKeyRef = useRef(storageKey);
  const pendingWritesRef = useRef(new Map<string, Promise<SavedItinerary>>());
  const syncRequestRef = useRef(0);
  activeStorageKeyRef.current = storageKey;

  const plans = useMemo(
    () => (plannerState.storageKey === storageKey ? plannerState.plans : []),
    [plannerState, storageKey],
  );

  useEffect(() => {
    setPlannerState((current) =>
      current.storageKey === storageKey
        ? current
        : { storageKey, plans: loadPlans(storageKey) },
    );
    setIsSyncing(false);
  }, [storageKey]);

  useEffect(() => {
    savePlans(plannerState.storageKey, plannerState.plans);
  }, [plannerState]);

  const updateStoredPlans = useCallback(
    (targetStorageKey: string, update: (current: Plan[]) => Plan[]) => {
      if (activeStorageKeyRef.current !== targetStorageKey) {
        savePlans(targetStorageKey, update(loadPlans(targetStorageKey)));
        return;
      }

      setPlannerState((current) =>
        current.storageKey === targetStorageKey
          ? { ...current, plans: update(current.plans) }
          : current,
      );
    },
    [],
  );

  const startCloudCreate = useCallback(
    (plan: Plan, ownerId: string, token: string): Promise<SavedItinerary> => {
      const writeKey = `${ownerId}:${plan.id}`;
      const previous = pendingWritesRef.current.get(writeKey);
      const request = (async () => {
        if (previous) {
          try {
            await previous;
          } catch {
            // A stable-ID retry may follow a failed request.
          }
        }
        return itinerariesService.saveItinerary(
          {
            id: plan.id,
            title: plan.name,
            params: { ...plan.params, description: plan.description },
            itinerary: plan.items,
          },
          getAuthOptions(token),
        );
      })();
      pendingWritesRef.current.set(writeKey, request);
      void request.then(
        () => {
          updateStoredPlans(getStorageKey(ownerId), (previousPlans) =>
            previousPlans.map((savedPlan) =>
              savedPlan.id === plan.id &&
              (savedPlan.localRevision ?? 0) === (plan.localRevision ?? 0)
                ? { ...savedPlan, isCloudSaved: true }
                : savedPlan,
            ),
          );
          if (pendingWritesRef.current.get(writeKey) === request) {
            pendingWritesRef.current.delete(writeKey);
          }
        },
        (error) => {
          if (pendingWritesRef.current.get(writeKey) === request) {
            pendingWritesRef.current.delete(writeKey);
          }
          logger.warn(`Failed to save plan '${plan.id}' to cloud:`, error);
        },
      );
      return request;
    },
    [updateStoredPlans],
  );

  const persistPlan = useCallback(
    (plan: Plan, ownerId: string, token: string): Promise<SavedItinerary> => {
      const writeKey = `${ownerId}:${plan.id}`;
      const previous = pendingWritesRef.current.get(writeKey);
      const request = (async () => {
        if (previous) {
          try {
            await previous;
          } catch {
            // Preserve the local draft and retry with its stable ID.
          }
        }
        if (plan.isCloudSaved !== true) {
          await itinerariesService.saveItinerary(
            {
              id: plan.id,
              title: plan.name,
              params: { ...plan.params, description: plan.description },
              itinerary: plan.items,
            },
            getAuthOptions(token),
          );
        }
        return itinerariesService.updateItinerary(
          plan.id,
          {
            title: plan.name,
            params: { ...plan.params, description: plan.description },
            itinerary: plan.items,
          },
          getAuthOptions(token),
        );
      })();
      pendingWritesRef.current.set(writeKey, request);
      void request.then(
        () => {
          updateStoredPlans(getStorageKey(ownerId), (previousPlans) =>
            previousPlans.map((savedPlan) =>
              savedPlan.id === plan.id &&
              (savedPlan.localRevision ?? 0) === (plan.localRevision ?? 0)
                ? { ...savedPlan, isCloudSaved: true }
                : savedPlan,
            ),
          );
          if (pendingWritesRef.current.get(writeKey) === request) {
            pendingWritesRef.current.delete(writeKey);
          }
        },
        (error) => {
          if (pendingWritesRef.current.get(writeKey) === request) {
            pendingWritesRef.current.delete(writeKey);
          }
          logger.warn(`Failed to update plan '${plan.id}' in cloud:`, error);
        },
      );
      return request;
    },
    [updateStoredPlans],
  );

  /**
   * Syncs local plans with cloud saved itineraries.
   * Merges server itineraries into local plans without destroying un-synced local changes.
   */
  const syncWithCloud = useCallback(async (): Promise<Plan[]> => {
    if (!userId || !accessToken) return loadPlans(storageKey);

    const targetStorageKey = storageKey;
    const requestId = ++syncRequestRef.current;
    setIsSyncing(true);
    try {
      const cloudItineraries = await itinerariesService.getMyItineraries(
        getAuthOptions(accessToken),
      );
      if (activeStorageKeyRef.current === targetStorageKey && Array.isArray(cloudItineraries)) {
        const cloudPlans = cloudItineraries.map(mapSavedItineraryToPlan);
        updateStoredPlans(targetStorageKey, (previous) => {
          const map = new Map<string, Plan>();
          previous
            .filter((plan) => plan.isCloudSaved !== true)
            .forEach((plan) => map.set(plan.id, plan));
          cloudPlans.forEach((cloudPlan) => {
            if (!map.has(cloudPlan.id)) map.set(cloudPlan.id, cloudPlan);
          });
          return Array.from(map.values());
        });
      }
    } catch (err) {
      logger.warn('Failed to sync plans with cloud:', err);
    } finally {
      if (
        activeStorageKeyRef.current === targetStorageKey &&
        syncRequestRef.current === requestId
      ) {
        setIsSyncing(false);
      }
    }
    return loadPlans(targetStorageKey);
  }, [accessToken, storageKey, updateStoredPlans, userId]);

  /**
   * Saves a specific local plan directly to cloud backend.
   */
  const savePlanToCloud = useCallback(
    async (planId: string): Promise<SavedItinerary> => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) throw new Error(`Plan '${planId}' not found`);
      if (!userId || !accessToken) {
        throw new Error('Sign in to save this plan to the cloud');
      }

      return startCloudCreate(plan, userId, accessToken);
    },
    [accessToken, plans, startCloudCreate, userId],
  );

  const createPlan = useCallback((
    name: string,
    description: string,
    initialItems: Omit<PlanItem, 'id'>[] = [],
  ): Plan => {
    const now = new Date().toISOString();
    const plan: Plan = {
      id: generateId(),
      name,
      description,
      createdAt: now,
      updatedAt: now,
      items: initialItems.map((item) => ({ ...item, id: generateId() })),
      params: { description },
      localRevision: 0,
      isCloudSaved: false,
    };
    updateStoredPlans(storageKey, (previous) => [...previous, plan]);

    if (userId && accessToken) {
      startCloudCreate(plan, userId, accessToken);
    }

    return plan;
  }, [accessToken, startCloudCreate, storageKey, updateStoredPlans, userId]);

  const updatePlan = useCallback(
    async (
      planId: string,
      updates: Partial<Pick<Plan, 'name' | 'description'>>,
    ): Promise<void> => {
      const existing = plans.find((plan) => plan.id === planId);
      if (!existing) throw new Error(`Plan '${planId}' not found`);
      const updated = {
        ...existing,
        ...updates,
        params: {
          ...existing.params,
          description: updates.description ?? existing.description,
        },
        localRevision: (existing.localRevision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        isCloudSaved: userId ? false : existing.isCloudSaved,
      };

      updateStoredPlans(storageKey, (previous) =>
        previous.map((plan) => (plan.id === planId ? updated : plan)),
      );

      if (userId && accessToken) {
        await persistPlan(updated, userId, accessToken);
      }
    },
    [accessToken, persistPlan, plans, storageKey, updateStoredPlans, userId],
  );

  const deletePlan = useCallback(
    async (planId: string): Promise<void> => {
      if (userId && accessToken) {
        const pendingWrite = pendingWritesRef.current.get(`${userId}:${planId}`);
        if (pendingWrite) {
          try {
            await pendingWrite;
          } catch {
            // A confirmed delete may proceed after a failed save.
          }
        }
        const deleted = await itinerariesService.deleteItinerary(
          planId,
          getAuthOptions(accessToken),
        );
        if (!deleted) throw new Error('Itinerary delete was not confirmed');
      }

      updateStoredPlans(storageKey, (previous) =>
        previous.filter((plan) => plan.id !== planId),
      );
    },
    [accessToken, storageKey, updateStoredPlans, userId],
  );

  const duplicatePlan = useCallback(
    (planId: string): Plan | null => {
      const existing = plans.find((p) => p.id === planId);
      if (!existing) return null;
      const now = new Date().toISOString();
      const newPlan: Plan = {
        ...existing,
        id: generateId(),
        name: `${existing.name} (Copy)`,
        createdAt: now,
        updatedAt: now,
        items: existing.items.map((i) => ({
          ...i,
          id: generateId(),
        })),
        params: { description: existing.description },
        localRevision: 0,
        isCloudSaved: false,
      };
      updateStoredPlans(storageKey, (previous) => [...previous, newPlan]);

      if (userId && accessToken) {
        startCloudCreate(newPlan, userId, accessToken);
      }

      return newPlan;
    },
    [accessToken, plans, startCloudCreate, storageKey, updateStoredPlans, userId],
  );

  const addItem = useCallback((planId: string, item: Omit<PlanItem, 'id'>): PlanItem => {
    const newItem: PlanItem = {
      ...item,
      id: generateId(),
    };
    const existing = plans.find((plan) => plan.id === planId);
    if (existing) {
      const updated = {
        ...existing,
        items: [...existing.items, newItem],
        localRevision: (existing.localRevision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        isCloudSaved: userId ? false : existing.isCloudSaved,
      };
      updateStoredPlans(storageKey, (previous) =>
        previous.map((plan) => (plan.id === planId ? updated : plan)),
      );
      if (userId && accessToken) {
        void persistPlan(updated, userId, accessToken);
      }
    }
    return newItem;
  }, [accessToken, persistPlan, plans, storageKey, updateStoredPlans, userId]);

  const updateItem = useCallback(
    (planId: string, itemId: string, updates: Partial<PlanItem>) => {
      const existing = plans.find((plan) => plan.id === planId);
      if (!existing) return;
      const updated = {
        ...existing,
        items: existing.items.map((item) =>
          item.id === itemId ? { ...item, ...updates } : item,
        ),
        localRevision: (existing.localRevision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        isCloudSaved: userId ? false : existing.isCloudSaved,
      };
      updateStoredPlans(storageKey, (previous) =>
        previous.map((plan) => (plan.id === planId ? updated : plan)),
      );
      if (userId && accessToken) {
        void persistPlan(updated, userId, accessToken);
      }
    },
    [accessToken, persistPlan, plans, storageKey, updateStoredPlans, userId],
  );

  const removeItem = useCallback((planId: string, itemId: string) => {
    const existing = plans.find((plan) => plan.id === planId);
    if (!existing) return;
    const updated = {
      ...existing,
      items: existing.items.filter((item) => item.id !== itemId),
      localRevision: (existing.localRevision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      isCloudSaved: userId ? false : existing.isCloudSaved,
    };
    updateStoredPlans(storageKey, (previous) =>
      previous.map((plan) => (plan.id === planId ? updated : plan)),
    );
    if (userId && accessToken) {
      void persistPlan(updated, userId, accessToken);
    }
  }, [accessToken, persistPlan, plans, storageKey, updateStoredPlans, userId]);

  const reorderItems = useCallback((planId: string, reorderedItems: PlanItem[]) => {
    const existing = plans.find((plan) => plan.id === planId);
    if (!existing) return;
    const updated = {
      ...existing,
      items: reorderedItems,
      localRevision: (existing.localRevision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      isCloudSaved: userId ? false : existing.isCloudSaved,
    };
    updateStoredPlans(storageKey, (previous) =>
      previous.map((plan) => (plan.id === planId ? updated : plan)),
    );
    if (userId && accessToken) {
      void persistPlan(updated, userId, accessToken);
    }
  }, [accessToken, persistPlan, plans, storageKey, updateStoredPlans, userId]);

  const getPlan = useCallback(
    (planId: string) => plans.find((p) => p.id === planId) || null,
    [plans],
  );

  const setPlanPublicationMetadata = useCallback(
    (planId: string, metadata: Record<string, unknown>): void => {
      updateStoredPlans(storageKey, (previous) =>
        previous.map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                params: {
                  ...plan.params,
                  ...metadata,
                  description: plan.description,
                },
              }
            : plan,
        ),
      );
    },
    [storageKey, updateStoredPlans],
  );

  const getDayLabels = useCallback((planId: string): string[] => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan || plan.items.length === 0) return ['Day 1'];
    const labels = new Set<string>(plan.items.map((i) => i.dayLabel));
    const sorted = Array.from(labels).sort((a: string, b: string) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
    return sorted.length > 0 ? sorted : ['Day 1'];
  }, [plans]);

  return {
    plans,
    isSyncing,
    syncWithCloud,
    savePlanToCloud,
    createPlan,
    updatePlan,
    deletePlan,
    duplicatePlan,
    addItem,
    updateItem,
    removeItem,
    reorderItems,
    setPlanPublicationMetadata,
    getPlan,
    getDayLabels,
  };
}
