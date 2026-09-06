import { apiClient, type RequestOptions } from "@/lib/api-client";
import type { PlanItem } from "@/hooks/usePlanner";
import type { SharedPlan } from "@/hooks/useSharedPlans";
import { itineraryTemplates, type SuggestedPlan } from "@/domain/itinerary-templates";

export type { SuggestedPlan };

export interface SavedItinerary<P = Record<string, unknown>, I = PlanItem[]> {
  id: string;
  user_id?: string;
  title: string;
  params?: P;
  itinerary: I;
  created_at: string;
  updated_at?: string;
  is_public?: boolean;
}

export interface CreateItineraryInput<P = Record<string, unknown>, I = PlanItem[]> {
  id?: string;
  title: string;
  params?: P;
  itinerary: I;
}

export interface UpdateItineraryInput<P = Record<string, unknown>, I = PlanItem[]> {
  title?: string;
  params?: P;
  itinerary?: I;
  is_public?: boolean;
}

export interface GetCommunityItinerariesOptions extends RequestOptions {
  category?: string;
  limit?: number;
  offset?: number;
}

const LOCAL_COMMUNITY_STORAGE_KEY = "alanya-community-plans";

function loadLocalCommunityPlans(): SharedPlan[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LOCAL_COMMUNITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as SharedPlan[];
    }
  } catch {
    // ignore corrupted data
  }
  return [];
}

function mapSharedPlanToSavedItinerary(shared: SharedPlan): SavedItinerary {
  const itemsWithIds: PlanItem[] = shared.items.map((item, index) => ({
    ...item,
    id: `shared-item-${shared.shareId}-${index}`,
  }));

  return {
    id: shared.shareId,
    title: shared.name,
    params: {
      description: shared.description,
      sharedBy: shared.authorName,
      category: shared.category,
      likes: shared.copyCount,
      forks: shared.copyCount,
    },
    itinerary: itemsWithIds,
    created_at: shared.sharedAt,
  };
}

function mapSuggestedPlanToSavedItinerary(suggested: SuggestedPlan): SavedItinerary {
  const itemsWithIds: PlanItem[] = suggested.items.map((item, index) => ({
    ...item,
    id: `template-item-${suggested.id}-${index}`,
  }));

  return {
    id: suggested.id,
    title: suggested.name,
    params: {
      description: suggested.description,
      category: suggested.category,
      isSuggestedTemplate: true,
    },
    itinerary: itemsWithIds,
    created_at: "2026-06-01T00:00:00Z",
  };
}

export class ItinerariesService {
  /**
   * Saves a new itinerary to the authenticated backend.
   */
  async saveItinerary<P = Record<string, unknown>, I = PlanItem[]>(
    input: CreateItineraryInput<P, I>,
    options?: RequestOptions,
  ): Promise<SavedItinerary<P, I>> {
    const response = await apiClient.post<SavedItinerary<P, I>>(
      "/itineraries",
      input,
      options,
    );
    if (!response?.id) {
      throw new Error("Itinerary create did not return a saved record");
    }
    return response;
  }

  /**
   * Retrieves all saved itineraries for the authenticated user.
   */
  async getMyItineraries(options?: RequestOptions): Promise<SavedItinerary[]> {
    return options
      ? apiClient.get<SavedItinerary[]>("/itineraries/me", options)
      : apiClient.get<SavedItinerary[]>("/itineraries/me");
  }

  /**
   * Retrieves a single itinerary by UUID, local ID, or starter template ID.
   */
  async getItineraryById(id: string, options?: RequestOptions): Promise<SavedItinerary | null> {
    try {
      const data = options
        ? await apiClient.get<SavedItinerary>(`/itineraries/${id}`, options)
        : await apiClient.get<SavedItinerary>(`/itineraries/${id}`);
      if (data && data.id) {
        return data;
      }
    } catch {
      // check local or template
    }

    // Search public local community plans
    const localCommunity = loadLocalCommunityPlans();
    const foundShared = localCommunity.find((sp) => sp.shareId === id || sp.originalPlanId === id);
    if (foundShared) {
      return mapSharedPlanToSavedItinerary(foundShared);
    }

    // Search starter template presets
    const foundTemplate = itineraryTemplates.find((sp) => sp.id === id);
    if (foundTemplate) {
      return mapSuggestedPlanToSavedItinerary(foundTemplate);
    }

    return null;
  }

  /**
   * Updates an itinerary's title, params, or items.
   */
  async updateItinerary<P = Record<string, unknown>, I = PlanItem[]>(
    id: string,
    input: UpdateItineraryInput<P, I>,
    options?: RequestOptions,
  ): Promise<SavedItinerary<P, I>> {
    const response = await apiClient.put<SavedItinerary<P, I>>(
      `/itineraries/${id}`,
      input,
      options,
    );
    if (!response?.id) {
      throw new Error("Itinerary update did not return a saved record");
    }
    return response;
  }

  /**
   * Deletes an itinerary by UUID or local ID.
   */
  async deleteItinerary(id: string, options?: RequestOptions): Promise<boolean> {
    const response = await apiClient.delete<{ success?: boolean } | boolean>(
      `/itineraries/${id}`,
      options,
    );
    return (
      response === true ||
      (typeof response === "object" && response !== null && response.success === true)
    );
  }

  /**
   * Retrieves featured / community shared itineraries.
   */
  async getCommunityItineraries(options: GetCommunityItinerariesOptions = {}): Promise<SavedItinerary[]> {
    try {
      const { category, limit, offset, params: extraParams, ...reqConfig } = options;
      const params: Record<string, string | number | undefined> = {};
      if (category && category !== "All") params.category = category;
      if (limit !== undefined) params.limit = limit;
      if (offset !== undefined) params.offset = offset;

      const data = await apiClient.get<SavedItinerary[]>("/itineraries/community", {
        ...reqConfig,
        params: { ...extraParams, ...params },
      });
      if (Array.isArray(data)) {
        return data;
      }
    } catch {
      // Fall back to starter domain templates
    }

    const localCommunity = loadLocalCommunityPlans();
    let result =
      localCommunity.length > 0
        ? localCommunity.map(mapSharedPlanToSavedItinerary)
        : itineraryTemplates.map(mapSuggestedPlanToSavedItinerary);

    if (options.category && options.category !== "All") {
      result = result.filter(
        (it) =>
          it.params &&
          typeof it.params === "object" &&
          "category" in it.params &&
          it.params.category === options.category
      );
    }

    if (options.limit !== undefined) {
      const offset = options.offset || 0;
      result = result.slice(offset, offset + options.limit);
    }

    return result;
  }
}

export const itinerariesService = new ItinerariesService();

export const saveItinerary = <P = Record<string, unknown>, I = PlanItem[]>(
  input: CreateItineraryInput<P, I>,
  options?: RequestOptions,
) => itinerariesService.saveItinerary(input, options);

export const getMyItineraries = (options?: RequestOptions) =>
  itinerariesService.getMyItineraries(options);

export const getItineraryById = (id: string, options?: RequestOptions) =>
  itinerariesService.getItineraryById(id, options);

export const updateItinerary = <P = Record<string, unknown>, I = PlanItem[]>(
  id: string,
  input: UpdateItineraryInput<P, I>,
  options?: RequestOptions,
) => itinerariesService.updateItinerary(id, input, options);

export const deleteItinerary = (id: string, options?: RequestOptions) =>
  itinerariesService.deleteItinerary(id, options);

export const getCommunityItineraries = (options?: GetCommunityItinerariesOptions) =>
  itinerariesService.getCommunityItineraries(options);
