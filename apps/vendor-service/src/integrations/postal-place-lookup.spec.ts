import { CommunityPostalPlaceLookup } from './postal-place-lookup';
import type { CommunitiesRepository } from '../repositories/communities.repository';

describe('CommunityPostalPlaceLookup', () => {
  it('resolves an omitted optional locality from an active directory record with optional geography omitted', async () => {
    const communities = {
      listCommunities: jest.fn().mockResolvedValue({
        items: [{
          PK: 'COMMUNITY_PIN#IN#682018#STATUS#ACTIVE',
          SK: 'NAME#tata tritvam#ID#com_in_kl_kochi_tata_tritvam',
          communityId: 'com_in_kl_kochi_tata_tritvam',
          name: 'Tata Tritvam',
          cityId: 'KOCHI',
          cityName: 'Kochi',
          localityId: 'KOCHI_MARINE_DRIVE',
          localityName: 'Marine Drive',
          postalCode: '682018',
          status: 'ACTIVE',
          searchText: 'tata tritvam marine drive',
        }],
      }),
    } as unknown as CommunitiesRepository;
    const lookup = new CommunityPostalPlaceLookup(communities);

    await expect(lookup.resolve({ postalCode: '682018', countryCode: 'IN' })).resolves.toEqual({
      postalCode: '682018',
      locality: 'Marine Drive',
      city: 'Kochi',
      district: undefined,
      state: undefined,
      countryCode: 'IN',
    });
  });
});
