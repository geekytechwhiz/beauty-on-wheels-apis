import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class UsersRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    UsersRepository;

export function getUsersRepository() {

    if (!repository) {

        repository =
            new UsersRepository();

    }

    return repository;

}
