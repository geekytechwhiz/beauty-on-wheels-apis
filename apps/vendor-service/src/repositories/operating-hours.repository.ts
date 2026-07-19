import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class OperatingHoursRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    OperatingHoursRepository;

export function getOperatingHoursRepository() {

    if (!repository) {

        repository =
            new OperatingHoursRepository();

    }

    return repository;

}
