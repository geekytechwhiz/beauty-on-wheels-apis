import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class PermissionsRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    PermissionsRepository;

export function getPermissionsRepository() {

    if (!repository) {

        repository =
            new PermissionsRepository();

    }

    return repository;

}
