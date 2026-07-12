import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class VehiclesRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    VehiclesRepository;

export function getVehiclesRepository() {

    if (!repository) {

        repository =
            new VehiclesRepository();

    }

    return repository;

}
