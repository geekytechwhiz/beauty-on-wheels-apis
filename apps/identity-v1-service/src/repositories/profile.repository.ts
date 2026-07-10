import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class ProfileRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    ProfileRepository;

export function getProfileRepository() {

    if (!repository) {

        repository =
            new ProfileRepository();

    }

    return repository;

}
