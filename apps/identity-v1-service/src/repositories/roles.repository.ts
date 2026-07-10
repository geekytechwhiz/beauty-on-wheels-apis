import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class RolesRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    RolesRepository;

export function getRolesRepository() {

    if (!repository) {

        repository =
            new RolesRepository();

    }

    return repository;

}
