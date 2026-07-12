import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class BookingsRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    BookingsRepository;

export function getBookingsRepository() {

    if (!repository) {

        repository =
            new BookingsRepository();

    }

    return repository;

}
