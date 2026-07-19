import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class HolidaysRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    HolidaysRepository;

export function getHolidaysRepository() {

    if (!repository) {

        repository =
            new HolidaysRepository();

    }

    return repository;

}
