import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class AvailabilityRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    AvailabilityRepository;

export function getAvailabilityRepository() {

    if (!repository) {

        repository =
            new AvailabilityRepository();

    }

    return repository;

}
