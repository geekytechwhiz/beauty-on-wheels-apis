import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class SessionsRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    SessionsRepository;

export function getSessionsRepository() {

    if (!repository) {

        repository =
            new SessionsRepository();

    }

    return repository;

}
