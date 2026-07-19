import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class ServiceAreasRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    ServiceAreasRepository;

export function getServiceAreasRepository() {

    if (!repository) {

        repository =
            new ServiceAreasRepository();

    }

    return repository;

}
