import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class CustomersRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    CustomersRepository;

export function getCustomersRepository() {

    if (!repository) {

        repository =
            new CustomersRepository();

    }

    return repository;

}
