import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class AddressesRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    AddressesRepository;

export function getAddressesRepository() {

    if (!repository) {

        repository =
            new AddressesRepository();

    }

    return repository;

}
