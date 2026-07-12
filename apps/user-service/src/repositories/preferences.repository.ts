import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class PreferencesRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    PreferencesRepository;

export function getPreferencesRepository() {

    if (!repository) {

        repository =
            new PreferencesRepository();

    }

    return repository;

}
