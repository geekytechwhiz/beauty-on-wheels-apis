import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class AuthenticationRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    AuthenticationRepository;

export function getAuthenticationRepository() {

    if (!repository) {

        repository =
            new AuthenticationRepository();

    }

    return repository;

}
