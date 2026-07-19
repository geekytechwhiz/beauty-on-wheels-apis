import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class SlotsRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    SlotsRepository;

export function getSlotsRepository() {

    if (!repository) {

        repository =
            new SlotsRepository();

    }

    return repository;

}
