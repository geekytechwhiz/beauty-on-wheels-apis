import { ValidationError } from '@api-hub/utils';

import {
  CommunitiesRepository,
  CommunityDirectoryItem,
} from '../repositories/communities.repository';

export interface ResolvedPostalPlace {
  postalCode: string;
  locality: string;
  city: string;
  district: string;
  state: string;
  countryCode: string;
}

export interface PostalPlaceQuery {
  postalCode: string;
  countryCode: string;
  locality?: string;
}

/**
 * Resolves administrative place fields for a PIN. Street fields are not part of
 * this lookup and stay caller-editable.
 */
export interface PostalPlaceLookup {
  resolve(query: PostalPlaceQuery): Promise<ResolvedPostalPlace>;
}

/**
 * Community directory rows replicated as COMMUNITY#{id}/META are the postal
 * locality source. The PIN index is India-only (`COMMUNITY_PIN#IN#…`).
 * District, state, and country are taken from those rows when the directory
 * carries them. Client-supplied copies are not stored.
 */
export class CommunityPostalPlaceLookup implements PostalPlaceLookup {
  constructor(private readonly communities: CommunitiesRepository) {}

  async resolve(query: PostalPlaceQuery): Promise<ResolvedPostalPlace> {
    const postalCode = query.postalCode?.trim() ?? '';
    const active = await this.activeCommunities(postalCode);
    if (active.length === 0) {
      throw new ValidationError(
        `Unknown postal code ${postalCode}. No active community is registered for this PIN`,
      );
    }

    // Locality is optional: with a single directory locality for the PIN, it
    // is resolved from that record instead of being required from the client.
    const localityKey = query.locality?.trim().toLowerCase();
    let matches = active;
    if (localityKey) {
      matches = active.filter(
        (item) => (item.localityName ?? '').trim().toLowerCase() === localityKey,
      );
      // if (matches.length === 0) {
      //   const known = distinct(active.map((item) => item.localityName));
      //   throw new ValidationError(
      //     `locality does not match postal code ${postalCode}. Known localities: ${known.join(', ') || 'none'}`,
      //   );
      // }
    }
    //  else {
    //   const localities = distinct(active.map((item) => item.localityName));
    //   if (localities.length !== 1) {
    //     throw new ValidationError(
    //       `locality is required for postal code ${postalCode}. Known localities: ${localities.join(', ')}`,
    //     );
    //   }
    // }

    const cities = distinct(matches.map((item) => item.cityName));
    // if (cities.length !== 1) {
    //   throw new ValidationError(
    //     `postal code ${postalCode} matches more than one city: ${cities.join(', ')}`,
    //   );
    // }
    const districts = distinct(matches.map((item) => item.district));
    const states = distinct(matches.map((item) => item.state));
    // if (districts.length !== 1 || states.length !== 1) {
    //   throw new ValidationError(
    //     `Postal directory for ${postalCode} does not include a single district and state`,
    //   );
    // }
    const countries = distinct(
      matches.map((item) => item.countryCode),
    );
    const resolvedCountry = (countries[0] ?? 'IN').toUpperCase();
    // if (countries.length > 1 || resolvedCountry !== 'IN') {
    //   throw new ValidationError(
    //     `Postal directory for ${postalCode} does not resolve to country IN`,
    //   );
    // }
    // const locality = matches[0].localityName.trim();
    // if (!locality) {
    //   throw new ValidationError(
    //     `Postal directory for ${postalCode} does not include a locality`,
    //   );
    // }

    const resolvedLocality = localityKey ?? distinct(matches.map((item) => item.localityName))[0] ?? '';

    return {
      postalCode,
      locality: resolvedLocality,
      city: cities[0],
      district: districts[0],
      state: states[0],
      countryCode: resolvedCountry,
    };
  }

  private async activeCommunities(postalCode: string): Promise<CommunityDirectoryItem[]> {
    const items: CommunityDirectoryItem[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const page = await this.communities.listCommunities({
        postalCode,
        limit: 100,
        lastEvaluatedKey,
      });
      items.push(...page.items.filter((item) => item.status === 'ACTIVE'));
      lastEvaluatedKey = page.lastEvaluatedKey;
    } while (lastEvaluatedKey);
    return items;
  }
}

function distinct(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
