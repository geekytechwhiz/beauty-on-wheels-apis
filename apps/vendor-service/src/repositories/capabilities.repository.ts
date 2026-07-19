import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class CapabilitiesRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    CapabilitiesRepository;

export function getCapabilitiesRepository() {

    if (!repository) {

        repository =
            new CapabilitiesRepository();

    }

    return repository;

}
